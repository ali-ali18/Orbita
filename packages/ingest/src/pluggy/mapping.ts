import {
	type CardConfig,
	daysBetween,
	decimalToCents,
	invoiceFor,
	isValidLocalDate,
	type LocalDate,
	toLocalDate,
} from "@orbita/core";
import type { AccountInput, CardInput, UpsertByExternalInput } from "@orbita/db";
import { DESCRIPTION_MAX, isCents, MAX_CENTS } from "@orbita/shared";
import type { PluggyAccount, PluggyTransaction } from "./schemas.ts";

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

export type MappedAccount =
	| { kind: "account"; externalId: string; input: AccountInput }
	| { kind: "card"; externalId: string; input: CardInput }
	| { kind: "ignored"; reason: string };

const NAME_MAX = 60;

function displayName(account: PluggyAccount, connectorName: string | null | undefined): string {
	const own = (account.marketingName?.trim() || account.name.trim() || "Conta").replace(/\s+/g, " ");
	const bank = connectorName?.trim();
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

/** Conta BANK vira `Account`; conta CREDIT vira `Card` (se o Pluggy disse quando fecha e vence). */
export function mapPluggyAccount(account: PluggyAccount, connectorName?: string | null): MappedAccount {
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
		const closingDay = dayOf(account.creditData?.balanceCloseDate);
		const dueDay = dayOf(account.creditData?.balanceDueDate);
		if (closingDay === null || dueDay === null) {
			return { kind: "ignored", reason: "o Pluggy não informou o fechamento e o vencimento da fatura" };
		}
		const digits = (account.number ?? "").replace(/\D/g, "");
		return {
			kind: "card",
			externalId: account.id,
			input: {
				name,
				last4: digits.length >= 4 ? digits.slice(-4) : null,
				closingDay,
				dueDay,
				limitCents: limitCentsOf(account.creditData?.creditLimit),
				source: PLUGGY_SOURCE,
				externalId: account.id,
			},
		};
	}
	return { kind: "ignored", reason: `tipo de conta ${account.type} não é suportado` };
}

// -------------------------------------------------------- lançamentos

export type SkipReason =
	| "pending" // ainda não efetivado: pode mudar de id ao efetivar
	| "invalid" // valor, data ou tipo que o Órbita não aceita
	| "foreign_currency"
	| "own_transfer" // entre contas do próprio dono: não é gasto nem receita
	| "card_payment" // o lado do cartão do pagamento da fatura (o lado do banco é quem conta)
	| "card_payment_unlinked" // pagamento de fatura que não dá para ligar a um cartão (o Órbita não tem pagamento "sem cartão")
	| "bills_unavailable" // as faturas não carregaram: não dá para saber se o débito/crédito é pagamento de fatura
	| "refund_without_original"; // estorno no cartão sem a compra original gravada (o sync tenta de novo)

export type MappedTransaction =
	| { action: "skip"; reason: SkipReason }
	| { action: "upsert"; externalId: string; input: UpsertByExternalInput }
	/** Estorno no cartão: o sync procura a compra original antes de gravar. */
	| {
			action: "refund";
			externalId: string;
			input: Omit<UpsertByExternalInput, "refundOfId">;
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

/** Valor (centavos) e dia de um lançamento, ou `null` se o Órbita não aceita. Base do casamento com as faturas. */
export function transactionFacts(tx: PluggyTransaction): { amountCents: number; date: LocalDate } | null {
	const amount = amountCentsOf(tx);
	const date = pluggyDateToLocal(tx.date);
	return typeof amount === "number" && date !== null ? { amountCents: amount, date } : null;
}

/** Minúsculo e sem acento, para comparar texto de categoria. */
const plain = (value: string | null | undefined) =>
	(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

// Categorias do Pluggy (nome em inglês ou português). Suposição conferida só contra fixtures: ver docs/pluggy.md.
const CARD_PAYMENT_CATEGORIES = [
	"credit card payment",
	"pagamento de cartao de credito",
	"pagamento de fatura",
];
const OWN_TRANSFER_CATEGORIES = ["same ownership", "same person", "mesma titularidade", "mesmo titular"];
// O lado do cartão do pagamento costuma vir sem categoria própria.
const CARD_SIDE_PAYMENT_DESCRIPTIONS = [
	"pagamento recebido",
	"pagamento de fatura",
	"pagamento fatura",
	"payment received",
];

const includesAny = (text: string, needles: readonly string[]) => needles.some((n) => text.includes(n));

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
	const category = plain(tx.category);
	const isCardPayment = includesAny(category, CARD_PAYMENT_CATEGORIES);
	const base = { amountCents: amount, date, description, categoryId: null, status: "confirmed" as const };

	if (ctx.accountType === "BANK") {
		if (ctx.accountId === null) return { action: "skip", reason: "invalid" };
		// Sem as faturas não dá para distinguir pagamento de fatura de gasto, e o upsert nunca corrige depois.
		if (tx.type === "DEBIT" && ctx.billsUnavailable) return { action: "skip", reason: "bills_unavailable" };
		// 1) Pagamento que o próprio Pluggy registrou na fatura (valor + dia, um débito por pagamento): sabe o cartão.
		const billPayment = tx.type === "DEBIT" ? ctx.billPaymentMatches?.get(tx.id) : undefined;
		if (billPayment) {
			return {
				action: "upsert",
				externalId: tx.id,
				input: { ...base, kind: "card_payment", accountId: ctx.accountId, cardId: billPayment.cardId },
			};
		}
		// 2) Sem pagamento para casar: o nome da categoria (suposição). Só liga a um cartão se o valor bate com o total
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
		if (isOwnTransferByDocument(tx, ctx.ownerTaxNumber) || includesAny(category, OWN_TRANSFER_CATEGORIES)) {
			return { action: "skip", reason: "own_transfer" };
		}
		return {
			action: "upsert",
			externalId: tx.id,
			input: { ...base, kind: tx.type === "DEBIT" ? "expense" : "income", accountId: ctx.accountId },
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
		return {
			action: "upsert",
			externalId: tx.id,
			input: { ...base, kind: "expense", cardId: ctx.card.id, invoiceMonth, note },
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
	return {
		action: "refund",
		externalId: tx.id,
		input: { ...base, kind: "refund", cardId: ctx.card.id, invoiceMonth, note },
		original: { amountCents: amount, description, date },
	};
}
