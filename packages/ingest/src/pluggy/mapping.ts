import { createHash } from "node:crypto";
import {
	addDays,
	addMonths,
	type CardConfig,
	daysBetween,
	decimalToCents,
	invoiceFor,
	isValidLocalDate,
	type LocalDate,
	monthOf,
	toLocalDate,
} from "@orbita/core";
import type { AccountInput, CardInput, UpsertByExternalInput } from "@orbita/db";
import {
	cleanMerchantName,
	cleanSourceCategory,
	DESCRIPTION_MAX,
	isCents,
	MAX_CENTS,
	MAX_INSTALLMENT_COUNT,
	normalizeMerchantName,
	pickCategoryRule,
} from "@orbita/shared";
import { cardDisplayName, cleanBankName, isMeuPluggyConnector } from "./bank-name.ts";
import {
	type CategoryIndex,
	categoryChain,
	classifyFamily,
	plain,
	readableCategory,
	suggestSpendingSlug,
} from "./classify.ts";
import { categoryForCnae, categoryForMcc } from "./mcc.ts";
import type { PluggyAccount, PluggyBill, PluggyTransaction } from "./schemas.ts";

/*
 * Do formato do Pluggy para o do Órbita. Tudo aqui é função pura (sem rede, sem banco, sem relógio).
 * O que o Pluggy manda é dado de terceiro: nada daqui vira instrução, e o que não bate é descartado com motivo.
 */

export const PLUGGY_SOURCE = "pluggy" as const;

// ---------------------------------------------------------------- datas

const MIDNIGHT_UTC = /^(\d{4}-\d{2}-\d{2})T00:00:00(?:\.0+)?(?:Z|\+00:00)$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Data de calendário de um carimbo do Pluggy. O Pluggy manda a data do lançamento como meia-noite UTC
 * ("2026-11-03T00:00:00.000Z"): é um DIA, não um instante, e convertê-la para São Paulo a empurraria para
 * o dia anterior. Meia-noite UTC (ou data pura) vale como está; qualquer outro instante é convertido para o
 * dia em America/Sao_Paulo. `null` se não for data.
 */
export function pluggyDateToLocal(value: string): LocalDate | null {
	const trimmed = value.trim();
	const midnight = MIDNIGHT_UTC.exec(trimmed);
	const local = midnight?.[1] ?? (DATE_ONLY.test(trimmed) ? trimmed : null);
	if (local !== null) return isValidLocalDate(local) ? local : null;
	const instant = new Date(trimmed);
	if (Number.isNaN(instant.getTime())) return null;
	return toLocalDate(instant);
}

// ------------------------------------------------------ contas e cartões

/** De onde saíram o fechamento e o vencimento de um cartão (do mais para o menos confiável). */
export type CardDatesOrigin =
	| "credit_data" // `creditData.balanceCloseDate` e `balanceDueDate`
	| "bill" // a fatura mais recente de `/bills` (`billClosingDate` e `dueDate`)
	| "due_date_only" // só o vencimento: fechamento = vencimento − 7 dias (estimado)
	| "default"; // nada veio: dias padrão (estimado)

export interface CardDates {
	closingDay: number;
	dueDay: number;
	origin: CardDatesOrigin;
}

/** Sem nenhuma data do banco: fecha dia 20 e vence dia 27 (mesma folga de 7 dias). O dono ajusta depois. */
export const DEFAULT_CARD_DATES = { closingDay: 20, dueDay: 27 } as const;
/** Dias entre fechamento e vencimento quando só o vencimento é conhecido (o usual no Brasil é 6 a 10). */
export const CLOSING_BEFORE_DUE_DAYS = 7;

export const isEstimatedCardDates = (origin: CardDatesOrigin) =>
	origin === "due_date_only" || origin === "default";

export type MappedAccount =
	| { kind: "account"; externalId: string; input: AccountInput }
	| { kind: "card"; externalId: string; input: CardInput; dates: CardDates }
	| { kind: "ignored"; reason: string };

const NAME_MAX = 60;

function displayName(account: PluggyAccount, connectorName: string | null | undefined): string {
	const own = cleanBankName(account.marketingName?.trim() || account.name.trim()) || "Conta";
	// "MeuPluggy" não é banco: o banco já vem no nome da conta, sem prefixo.
	const bank = isMeuPluggyConnector(connectorName) ? undefined : connectorName?.trim();
	const full = bank && !own.toLowerCase().includes(bank.toLowerCase()) ? `${bank} ${own}` : own;
	return full.slice(0, NAME_MAX).trim();
}

function dayOf(value: string | null | undefined): number | null {
	if (!value) return null;
	const date = pluggyDateToLocal(value);
	return date === null ? null : Number(date.slice(8, 10));
}

function limitCentsOf(value: number | string | null | undefined): number | null {
	if (value === null || value === undefined) return null;
	try {
		const cents = decimalToCents(value);
		return cents >= 0 && cents <= MAX_CENTS ? cents : null;
	} catch {
		return null;
	}
}

/**
 * Fechamento e vencimento do cartão, em ordem: `creditData` (datas da fatura atual) → fatura mais recente de `/bills`
 * com as duas datas → só o vencimento (de `creditData` ou da fatura mais recente), com fechamento 7 dias antes →
 * dias padrão. Nunca devolve `null`: um cartão sem datas ainda tem de entrar (as compras dependem dele); quem usa
 * avisa o dono quando `isEstimatedCardDates(origin)`.
 */
export function resolveCardDates(account: PluggyAccount, bills: readonly PluggyBill[] = []): CardDates {
	const closeNow = dayOf(account.creditData?.balanceCloseDate);
	const dueNow = dayOf(account.creditData?.balanceDueDate);
	if (closeNow !== null && dueNow !== null)
		return { closingDay: closeNow, dueDay: dueNow, origin: "credit_data" };

	const dated = bills
		.flatMap((bill) => {
			const due = bill.dueDate ? pluggyDateToLocal(bill.dueDate) : null;
			const closing = bill.billClosingDate ? pluggyDateToLocal(bill.billClosingDate) : null;
			return due === null ? [] : [{ due, closing }];
		})
		.sort((a, b) => b.due.localeCompare(a.due));
	const full = dated.find((b) => b.closing !== null);
	if (full?.closing) {
		return { closingDay: Number(full.closing.slice(8)), dueDay: Number(full.due.slice(8)), origin: "bill" };
	}

	const due = account.creditData?.balanceDueDate
		? pluggyDateToLocal(account.creditData.balanceDueDate)
		: (dated[0]?.due ?? null);
	if (due !== null) {
		return {
			closingDay: Number(addDays(due, -CLOSING_BEFORE_DUE_DAYS).slice(8)),
			dueDay: Number(due.slice(8)),
			origin: "due_date_only",
		};
	}
	return { ...DEFAULT_CARD_DATES, origin: "default" };
}

/** Conta BANK vira `Account`; conta CREDIT vira `Card` (datas por `resolveCardDates`; `bills` são as faturas dela). */
export function mapPluggyAccount(
	account: PluggyAccount,
	connectorName?: string | null,
	bills: readonly PluggyBill[] = [],
	/** Banco da conexão (ver `detectBankName`); dá nome ao cartão quando o Pluggy só manda "G" ou "Mastercard Gold". */
	bankName: string | null = null,
): MappedAccount {
	if (account.currencyCode && account.currencyCode !== "BRL") {
		return { kind: "ignored", reason: `moeda ${account.currencyCode} não é suportada` };
	}
	const name = displayName(account, connectorName);
	if (account.type === "BANK") {
		return {
			kind: "account",
			externalId: account.id,
			input: {
				name,
				kind: account.subtype === "SAVINGS_ACCOUNT" ? "savings" : "checking",
				source: PLUGGY_SOURCE,
				externalId: account.id,
			},
		};
	}
	if (account.type === "CREDIT") {
		const dates = resolveCardDates(account, bills);
		const digits = (account.number ?? "").replace(/\D/g, "");
		const own = cleanBankName(account.marketingName?.trim() || account.name.trim()) || "Cartão";
		const bank = bankName ?? (isMeuPluggyConnector(connectorName) ? null : (connectorName?.trim() ?? null));
		return {
			kind: "card",
			externalId: account.id,
			input: {
				name:
					cardDisplayName(own, bank || null)
						.slice(0, NAME_MAX)
						.trim() || name,
				last4: digits.length >= 4 ? digits.slice(-4) : null,
				closingDay: dates.closingDay,
				dueDay: dates.dueDay,
				limitCents: limitCentsOf(account.creditData?.creditLimit),
				source: PLUGGY_SOURCE,
				externalId: account.id,
			},
			dates,
		};
	}
	return { kind: "ignored", reason: `tipo de conta ${account.type} não é suportado` };
}

// -------------------------------------------------------- lançamentos

export type SkipReason =
	| "pending" // ainda não efetivado: pode mudar de id ao efetivar
	| "invalid" // valor, data ou tipo que o Órbita não aceita
	| "foreign_currency"
	| "investment" // aplicação, resgate, caixinha, poupança: o dinheiro só mudou de bolso (o Órbita não tem conta de investimento)
	| "card_payment" // o lado do cartão do pagamento da fatura (o lado do banco é quem conta)
	| "card_payment_unlinked" // pagamento de fatura que não dá para ligar a um cartão (o Órbita não tem pagamento "sem cartão")
	| "bills_unavailable" // as faturas não carregaram: não dá para saber se o débito/crédito é pagamento de fatura
	| "refund_without_original"; // estorno no cartão sem a compra original gravada (o sync tenta de novo)

/** O que decidiu a categoria de uma despesa, na ordem de prioridade. */
export type CategorySource = "rule" | "mcc" | "cnae" | "pluggy" | "none";

export type MappedTransaction =
	| { action: "skip"; reason: SkipReason }
	| {
			action: "upsert";
			externalId: string;
			input: UpsertByExternalInput;
			/** De onde veio a categoria (só despesa); `none` = caiu em "Outros" sem pista. */
			categorySource?: CategorySource;
			/** Parcela de compra parcelada no cartão: entra num grupo que cresce a cada fatura. */
			installment?: { groupId: string; number: number; count: number };
	  }
	/** Estorno no cartão: o sync procura a compra original antes de gravar. */
	| {
			action: "refund";
			externalId: string;
			input: Omit<UpsertByExternalInput, "refundOfId">;
			categorySource?: CategorySource;
			original: { amountCents: number; description: string; date: LocalDate };
	  };

/** Pagamento de fatura que o Pluggy registrou em `GET /bills` (valor e dia), ligado ao cartão do Órbita. */
export interface BillPayment {
	cardId: string;
	amountCents: number;
	date: LocalDate;
}

/** Pagamento na conta e na fatura costumam cair no mesmo dia; folga de 3 dias para compensação. */
const BILL_PAYMENT_DAYS = 3;

/** Total de uma fatura (`GET /bills`), para o plano B: pagamento por categoria só liga ao cartão cujo total bate. */
export interface BillTotal {
	cardId: string;
	amountCents: number;
}

/** Um lançamento que pode ser pagamento de fatura (débito da conta ou crédito do cartão). */
export interface PaymentCandidate {
	id: string;
	amountCents: number;
	date: LocalDate;
}

/**
 * Casa cada pagamento da fatura com UM lançamento: mesmo valor, até 3 dias de diferença, preferindo o mesmo dia e
 * depois o mais próximo. Pagamento consumido não casa de novo, então um aluguel de mesmo valor dois dias depois (ou
 * um estorno real de mesmo valor no cartão) continua sendo gasto/estorno. Devolve `id do lançamento → pagamento`.
 */
export function assignBillPayments(
	candidates: readonly PaymentCandidate[],
	payments: readonly BillPayment[],
): Map<string, BillPayment> {
	const assigned = new Map<string, BillPayment>();
	const ordered = [...payments].sort(
		(a, b) =>
			a.date.localeCompare(b.date) || a.amountCents - b.amountCents || a.cardId.localeCompare(b.cardId),
	);
	for (const payment of ordered) {
		let best: { candidate: PaymentCandidate; distance: number } | undefined;
		for (const candidate of candidates) {
			if (assigned.has(candidate.id) || candidate.amountCents !== payment.amountCents) continue;
			const distance = Math.abs(daysBetween(payment.date, candidate.date));
			if (distance > BILL_PAYMENT_DAYS) continue;
			if (
				!best ||
				distance < best.distance ||
				(distance === best.distance &&
					(candidate.date < best.candidate.date ||
						(candidate.date === best.candidate.date && candidate.id < best.candidate.id)))
			) {
				best = { candidate, distance };
			}
		}
		if (best) assigned.set(best.candidate.id, payment);
	}
	return assigned;
}

export interface TransactionContext {
	accountType: "BANK" | "CREDIT";
	/** Conta do Órbita (para `BANK`). */
	accountId: string | null;
	/** Cartão do Órbita e a regra de fatura dele (para `CREDIT`). */
	card: { id: string; config: CardConfig } | null;
	/** CPF/CNPJ do titular da conta (`taxNumber`), para reconhecer transferência para si mesmo. */
	ownerTaxNumber?: string | null;
	/** Nome do titular da conta (`owner`), para reconhecer Pix para si mesmo quando o banco não manda o CPF. */
	ownerName?: string | null;
	/**
	 * Destino de cada transferência própria que o sync conseguiu PAREAR de forma única (id do lançamento do Pluggy →
	 * conta do Órbita da outra ponta). Sem par, a transferência é gravada sem destino ("outra conta sua").
	 */
	ownTransferCounterparts?: ReadonlyMap<string, string>;
	/**
	 * Quais lançamentos são pagamento de fatura, já casados um a um (`assignBillPayments`), por id do lançamento.
	 * Mais confiável que o nome da categoria.
	 */
	billPaymentMatches?: ReadonlyMap<string, BillPayment>;
	/** Totais das faturas (plano B por categoria). */
	billTotals?: readonly BillTotal[];
	/** Mês de cada fatura (`billId` → mês do vencimento): vale mais que o cálculo pelo dia de fechamento. */
	billMonths?: ReadonlyMap<string, string>;
	/** As faturas não carregaram: débito da conta e crédito do cartão ficam de fora até carregarem. */
	billsUnavailable?: boolean;
	/** A árvore de categorias do Pluggy (`GET /categories`); sem ela vale só o nome da categoria do lançamento. */
	categoryIndex?: CategoryIndex;
	/** Categorias do Órbita por slug → id. Sem ela, o lançamento fica sem categoria. */
	categoryIds?: ReadonlyMap<string, string>;
	/** Regras do dono (padrão → categoria): vencem MCC, CNAE e a categoria do Pluggy. */
	categoryRules?: readonly { pattern: string; categoryId: string }[];
}

const digits = (value: string | null | undefined) => (value ?? "").replace(/\D/g, "");

/**
 * Transferência para o próprio dono: Pix/TED em que pagador e recebedor têm o mesmo CPF/CNPJ
 * (`paymentData.payer/receiver.documentNumber`), ou em que a outra ponta é o titular da conta.
 */
function isOwnTransferByDocument(tx: PluggyTransaction, ownerTaxNumber: string | null | undefined): boolean {
	const payer = digits(tx.paymentData?.payer?.documentNumber?.value);
	const receiver = digits(tx.paymentData?.receiver?.documentNumber?.value);
	if (payer && receiver && payer === receiver) return true;
	const owner = digits(ownerTaxNumber);
	const other = tx.type === "DEBIT" ? receiver : payer;
	return owner !== "" && other === owner;
}

/** Nome só com letras, minúsculo e sem acento; vazio se tiver menos de duas palavras (um primeiro nome não prova nada). */
function personName(value: string | null | undefined): string {
	const name = plain(value)
		.replace(/[^a-z\s]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	return name.split(" ").length >= 2 ? name : "";
}

/** "Pix enviado - Fulano de Tal" → "Fulano de Tal": a ponta que o banco escreveu na descrição. */
const COUNTERPART_IN_DESCRIPTION = /^(?:pix|ted|doc|transfer[^-–]*)[^-–]*[-–]\s*(.+)$/i;

/**
 * Transferência para si mesmo pelo NOME: a outra ponta (`paymentData`, ou o que vem depois do hífen em "Pix enviado -
 * Nome") é igual ao titular da conta, palavra por palavra. É mais fraco que o CPF, por isso só vale com igualdade exata
 * de um nome com pelo menos duas palavras: homônimo parcial ("Maria Silva" x "Maria Souza Silva") continua sendo gasto.
 */
function isOwnTransferByName(
	tx: PluggyTransaction,
	description: string,
	ownerName: string | null | undefined,
): boolean {
	const owner = personName(ownerName);
	if (owner === "") return false;
	const names = [
		tx.type === "DEBIT" ? tx.paymentData?.receiver?.name : tx.paymentData?.payer?.name,
		COUNTERPART_IN_DESCRIPTION.exec(description.trim())?.[1],
	];
	return names.some((name) => personName(name) === owner);
}

/** Valor (centavos) e dia de um lançamento, ou `null` se o Órbita não aceita. Base do casamento com as faturas. */
export function transactionFacts(tx: PluggyTransaction): { amountCents: number; date: LocalDate } | null {
	const amount = amountCentsOf(tx);
	const date = pluggyDateToLocal(tx.date);
	return typeof amount === "number" && date !== null ? { amountCents: amount, date } : null;
}

// O lado do cartão do pagamento costuma vir sem categoria própria.
const CARD_SIDE_PAYMENT_DESCRIPTIONS = [
	"pagamento recebido",
	"pagamento de fatura",
	"pagamento fatura",
	"payment received",
];

const includesAny = (text: string, needles: readonly string[]) => needles.some((n) => text.includes(n));

interface CategoryChoice {
	categoryId: string | null;
	source: CategorySource;
}

/**
 * Categoria de consumo, em ordem: regra do dono → MCC do estabelecimento → CNAE → categoria do Pluggy → Outros.
 * Sem as categorias do Órbita carregadas (`categoryIds`), só uma regra do dono ainda decide.
 */
function chooseCategory(
	tx: PluggyTransaction,
	chain: readonly string[],
	description: string,
	merchantName: string | null,
	ctx: TransactionContext,
): CategoryChoice {
	const rule = pickCategoryRule(ctx.categoryRules ?? [], merchantName, description);
	if (rule) return { categoryId: rule.categoryId, source: "rule" };
	const ids = ctx.categoryIds;
	if (!ids) return { categoryId: null, source: "none" };
	const bySlug = (slug: string | null) => (slug === null ? null : (ids.get(slug) ?? null));
	const mcc = bySlug(categoryForMcc(tx.creditCardMetadata?.payeeMCC));
	if (mcc) return { categoryId: mcc, source: "mcc" };
	const cnae = bySlug(categoryForCnae(tx.merchant?.cnae));
	if (cnae) return { categoryId: cnae, source: "cnae" };
	// A categoria do banco decide. Pix e "Outros" do banco não dizem o consumo: aí vale a descrição e o
	// estabelecimento, com a mesma tabela.
	const fromNames = suggestSpendingSlug({
		sourceCategory: chain.join(" › "),
		description,
		merchantName,
	});
	const pluggy = bySlug(fromNames);
	if (pluggy) return { categoryId: pluggy, source: "pluggy" };
	return { categoryId: ids.get("outros") ?? null, source: "none" };
}

/**
 * Lançamento já gravado, que o dono não editou, e que caiu em Outros: a sincronização pode trocar para uma
 * categoria específica. Não mexe no que o dono escolheu, nem apaga uma categoria boa.
 */
export function shouldUpgradeCategory(
	current: { kind: string; categoryId: string | null; categoryEditedByOwner: boolean },
	nextCategoryId: string | null,
	outrosId: string | null,
): boolean {
	if (current.categoryEditedByOwner) return false;
	if (current.kind !== "expense" && current.kind !== "refund") return false;
	if (nextCategoryId === null || nextCategoryId === outrosId) return false;
	return current.categoryId === null || current.categoryId === outrosId;
}

/** Id do grupo de um parcelamento do Pluggy: o mesmo para todas as parcelas da mesma compra, em qualquer sincronização. */
export function pluggyInstallmentGroupId(input: {
	cardId: string;
	purchaseDate: LocalDate;
	count: number;
	description: string;
}): string {
	const name =
		normalizeMerchantName(input.description.replace(/\bparc(ela)?\b/gi, " ")) || plain(input.description);
	const hash = createHash("sha256")
		.update(JSON.stringify([input.cardId, input.purchaseDate, input.count, name]))
		.digest("hex");
	return `pluggy-${hash.slice(0, 40)}`;
}

function describe(tx: PluggyTransaction): string {
	const text = (tx.description?.trim() || tx.descriptionRaw?.trim() || "Sem descrição").replace(/\s+/g, " ");
	return text.slice(0, DESCRIPTION_MAX);
}

/** Valor em centavos, positivo. Moeda estrangeira só com o valor já convertido para a conta. */
function amountCentsOf(tx: PluggyTransaction): number | "foreign_currency" | null {
	const foreign = Boolean(tx.currencyCode) && tx.currencyCode !== "BRL";
	if (foreign && (tx.amountInAccountCurrency === null || tx.amountInAccountCurrency === undefined)) {
		return "foreign_currency";
	}
	try {
		const cents = Math.abs(
			decimalToCents(foreign ? (tx.amountInAccountCurrency as number | string) : tx.amount),
		);
		return isCents(cents) && cents > 0 && cents <= MAX_CENTS ? cents : null;
	} catch {
		return null;
	}
}

/** Decide o que fazer com um lançamento do Pluggy. Não toca em banco nem em rede. */
export function mapPluggyTransaction(tx: PluggyTransaction, ctx: TransactionContext): MappedTransaction {
	if (tx.status === "PENDING") return { action: "skip", reason: "pending" };
	if (tx.type !== "DEBIT" && tx.type !== "CREDIT") return { action: "skip", reason: "invalid" };
	const amount = amountCentsOf(tx);
	if (amount === "foreign_currency") return { action: "skip", reason: "foreign_currency" };
	const date = pluggyDateToLocal(tx.date);
	if (amount === null || date === null) return { action: "skip", reason: "invalid" };

	const description = describe(tx);
	const chain = categoryChain(tx, ctx.categoryIndex);
	const family = classifyFamily({
		chain,
		description,
		direction: tx.type === "DEBIT" ? "out" : "in",
		allowDescriptionFallback: ctx.accountType === "BANK",
	});
	const isCardPayment = family === "card_payment";
	const merchantName = cleanMerchantName(tx.merchant?.name?.trim() || tx.merchant?.businessName?.trim());
	const base = {
		amountCents: amount,
		date,
		description,
		categoryId: null,
		status: "confirmed" as const,
		sourceCategory: cleanSourceCategory(readableCategory(tx, ctx.categoryIndex)),
		merchantName,
	};
	const choose = () => chooseCategory(tx, chain, description, merchantName, ctx);

	if (ctx.accountType === "BANK") {
		if (ctx.accountId === null) return { action: "skip", reason: "invalid" };
		// 1) Pagamento que o próprio Pluggy registrou na fatura (valor + dia, um débito por pagamento): sabe o cartão.
		const billPayment = tx.type === "DEBIT" ? ctx.billPaymentMatches?.get(tx.id) : undefined;
		if (billPayment) {
			return {
				action: "upsert",
				externalId: tx.id,
				input: { ...base, kind: "card_payment", accountId: ctx.accountId, cardId: billPayment.cardId },
			};
		}
		// 2) Aplicação sai do saldo e vira `investment` (categoria Investimentos): NÃO é gasto, aparece à parte como
		// "Investido". Resgate e rendimento voltam como receita nessa categoria. Transferência entre contas suas continua de fora (abaixo).
		if (family === "investment" || family === "yield") {
			const categoryId = ctx.categoryIds?.get("investimentos") ?? null;
			if (tx.type === "CREDIT") {
				return {
					action: "upsert",
					externalId: tx.id,
					input: { ...base, kind: "income", accountId: ctx.accountId, categoryId },
				};
			}
			return {
				action: "upsert",
				externalId: tx.id,
				input: { ...base, kind: "investment", accountId: ctx.accountId, categoryId },
				categorySource: "pluggy",
			};
		}
		// Sem as faturas não dá para distinguir pagamento de fatura de gasto, e o upsert nunca corrige depois.
		if (tx.type === "DEBIT" && ctx.billsUnavailable) return { action: "skip", reason: "bills_unavailable" };
		// 3) Sem pagamento para casar: o nome da categoria (suposição). Só liga a um cartão se o valor bate com o total
		// de uma fatura de um único cartão; senão fica de fora (o Órbita não tem pagamento de fatura "sem cartão").
		if (isCardPayment) {
			if (tx.type === "CREDIT") return { action: "skip", reason: "card_payment" };
			const cards = new Set(
				(ctx.billTotals ?? []).filter((b) => b.amountCents === amount).map((b) => b.cardId),
			);
			const [only] = [...cards];
			if (cards.size !== 1 || only === undefined) return { action: "skip", reason: "card_payment_unlinked" };
			return {
				action: "upsert",
				externalId: tx.id,
				input: { ...base, kind: "card_payment", accountId: ctx.accountId, cardId: only },
			};
		}
		if (
			isOwnTransferByDocument(tx, ctx.ownerTaxNumber) ||
			isOwnTransferByName(tx, description, ctx.ownerName) ||
			family === "own_transfer"
		) {
			// Entrada e saída viram `transfer` (nem gasto nem receita), cada uma na conta que a viu. O destino só é
			// preenchido quando as duas pontas foram pareadas com certeza; senão fica vazio.
			return {
				action: "upsert",
				externalId: tx.id,
				input: {
					...base,
					kind: "transfer",
					accountId: ctx.accountId,
					counterpartAccountId: ctx.ownTransferCounterparts?.get(tx.id) ?? null,
					categoryId: ctx.categoryIds?.get("transferencias") ?? null,
				},
			};
		}
		// Rendimento de investimento é receita de verdade (o principal que volta, não: ver acima).
		if (tx.type === "CREDIT") {
			return {
				action: "upsert",
				externalId: tx.id,
				input: { ...base, kind: "income", accountId: ctx.accountId },
			};
		}
		const choice = choose();
		return {
			action: "upsert",
			externalId: tx.id,
			input: { ...base, kind: "expense", accountId: ctx.accountId, categoryId: choice.categoryId },
			categorySource: choice.source,
		};
	}

	// Cartão de crédito.
	if (ctx.card === null) return { action: "skip", reason: "invalid" };
	const meta = tx.creditCardMetadata;
	// A fatura que o próprio Pluggy indica (billId → mês do vencimento) vale mais que o cálculo pelo fechamento.
	const invoiceMonth =
		(meta?.billId ? ctx.billMonths?.get(meta.billId) : undefined) ?? invoiceFor(date, ctx.card.config).month;
	const installment =
		meta?.installmentNumber && meta.totalInstallments && meta.totalInstallments > 1
			? `Parcela ${meta.installmentNumber}/${meta.totalInstallments}`
			: null;
	// Parcela do Pluggy vem avulsa (uma por fatura, sem id de grupo); fica como lançamento simples, com a
	// informação na observação. Ligar ao `createInstallmentGroup` fica para depois.
	const note = installment;

	if (tx.type === "DEBIT") {
		const choice = choose();
		const purchaseDate = meta?.purchaseDate ? pluggyDateToLocal(meta.purchaseDate) : null;
		const number = meta?.installmentNumber ?? null;
		const count = meta?.totalInstallments ?? null;
		const grouped =
			purchaseDate !== null &&
			number !== null &&
			count !== null &&
			count > 1 &&
			count <= MAX_INSTALLMENT_COUNT &&
			number >= 1 &&
			number <= count;
		// Sem a data da compra não há como reconhecer a mesma compra nas outras faturas: fica avulsa, com a nota.
		const groupInput =
			grouped && purchaseDate !== null && number !== null && count !== null
				? {
						// Como nas parcelas lançadas à mão: todas levam a data da compra e a n-ésima pesa no n-ésimo mês.
						date: purchaseDate,
						budgetMonth: addMonths(monthOf(purchaseDate), number - 1),
						installment: {
							groupId: pluggyInstallmentGroupId({
								cardId: ctx.card.id,
								purchaseDate,
								count,
								description,
							}),
							number,
							count,
						},
					}
				: null;
		return {
			action: "upsert",
			externalId: tx.id,
			input: {
				...base,
				...(groupInput ? { date: groupInput.date, budgetMonth: groupInput.budgetMonth } : {}),
				kind: "expense",
				cardId: ctx.card.id,
				invoiceMonth,
				note,
				categoryId: choice.categoryId,
			},
			categorySource: choice.source,
			...(groupInput ? { installment: groupInput.installment } : {}),
		};
	}
	if (ctx.billsUnavailable) return { action: "skip", reason: "bills_unavailable" };
	const side = plain(tx.description) || plain(tx.descriptionRaw);
	if (
		ctx.billPaymentMatches?.has(tx.id) ||
		isCardPayment ||
		includesAny(side, CARD_SIDE_PAYMENT_DESCRIPTIONS)
	) {
		return { action: "skip", reason: "card_payment" };
	}
	const refundChoice = choose();
	return {
		action: "refund",
		externalId: tx.id,
		input: {
			...base,
			kind: "refund",
			cardId: ctx.card.id,
			invoiceMonth,
			note,
			categoryId: refundChoice.categoryId,
		},
		categorySource: refundChoice.source,
		original: { amountCents: amount, description, date },
	};
}
