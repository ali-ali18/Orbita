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
import { bankIspb, cardDisplayName, cleanBankName, isMeuPluggyConnector } from "./bank-name.ts";
import {
	type CategoryIndex,
	categoryChain,
	classifyFamily,
	isCardSidePayment,
	isGoogleDigitalCharge,
	normalizeOperationType,
	operationSignal,
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
				...(bankIspb(bankName) ? { bankCode: bankIspb(bankName) } : {}),
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
				// O emissor vem da conexão (ISPB), não do nome do cartão ("FREE VISA" não diz que é Santander).
				...(bankIspb(bank) ? { bankCode: bankIspb(bank) } : {}),
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
	/**
	 * PENDING que o Órbita não conta: tudo na CONTA (agendado, em processamento: docs.pluggy.ai/docs/transactions) e o
	 * crédito pendente do cartão. A compra pendente do CARTÃO entra (ver `mapPluggyTransaction`).
	 */
	| "pending"
	| "invalid" // valor, data ou tipo que o Órbita não aceita
	| "foreign_currency"
	| "investment" // aplicação, resgate, caixinha, poupança: o dinheiro só mudou de bolso (o Órbita não tem conta de investimento)
	| "card_payment" // o lado do cartão do pagamento da fatura (o lado do banco é quem conta)
	| "card_payment_unlinked" // pagamento de fatura que não dá para ligar a um cartão (o Órbita não tem pagamento "sem cartão")
	| "bills_unavailable" // as faturas não carregaram: não dá para saber se o débito/crédito é pagamento de fatura
	| "refund_without_original"; // estorno na conta sem a despesa original gravada (o sync tenta de novo)

/** O que decidiu a categoria de uma despesa, na ordem de prioridade. */
export type CategorySource = "rule" | "digital" | "mcc" | "cnae" | "pluggy" | "none";

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
			/**
			 * O `invoiceMonth` veio do banco (`billId` ou `billForecastDate`), não do cálculo pelo fechamento: vale corrigir
			 * o já gravado.
			 */
			invoiceFromBill?: true;
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

/** Pagamento da fatura pode cair até 5 dias antes ou depois do vencimento (fim de semana, compensação, atraso curto). */
export const BILL_DUE_DAYS = 5;

/** Uma fatura de um cartão conectado (de qualquer conexão): total, o que falta pagar e o vencimento. */
export interface BillInfo {
	cardId: string;
	totalCents: number;
	remainingCents: number;
	dueDate: LocalDate | null;
	/**
	 * Fatura aberta sintética (soma das compras PENDING, o banco não a manda em `/bills`): as pendentes por dia. O
	 * pagamento adiantado casa com a soma das que têm data até o dia do débito (compra nova depois do pagamento não o
	 * quebra), e só numa janela em torno delas (`OPEN_BILL_WINDOW_DAYS` depois da última). Sem isto vale `totalCents`.
	 */
	pending?: readonly { date: LocalDate; amountCents: number }[];
}

/** Quantos dias depois da última compra pendente um pagamento ainda pode ser o da fatura aberta sintética. */
export const OPEN_BILL_WINDOW_DAYS = 31;

/** O débito (valor e dia) é a soma das pendentes até o dia dele, dentro da janela da fatura aberta sintética. */
function matchesOpenBill(
	pending: readonly { date: LocalDate; amountCents: number }[],
	amountCents: number,
	date: LocalDate | undefined,
): boolean {
	if (date === undefined || pending.length === 0) return false;
	const dates = pending.map((p) => p.date).sort();
	const first = dates[0] as LocalDate;
	const last = dates[dates.length - 1] as LocalDate;
	if (date < first || daysBetween(last, date) > OPEN_BILL_WINDOW_DAYS) return false;
	let sum = 0;
	for (const p of pending) if (p.date <= date) sum += p.amountCents;
	return sum === amountCents;
}

export const CARD_BILL_SLUG = "fatura-cartao";
export const PAYMENT_UNCONNECTED_NOTE = "Pagamento de fatura: cartão não conectado.";
export const PAYMENT_REVIEW_NOTE =
	"Pagamento de fatura: não deu para saber de qual cartão. Confira e ligue ao cartão.";

/** Palavras do nome do cartão que não dizem o emissor. */
const GENERIC_CARD_WORDS = new Set([
	"cartao",
	"credito",
	"card",
	"mastercard",
	"visa",
	"elo",
	"gold",
	"platinum",
	"black",
	"infinite",
	"standard",
	"internacional",
	"nacional",
	"banco",
	"pagamento",
	"conta",
]);

/** Cartões cujo nome (ou final) aparece na descrição do pagamento. */
function cardsNamedIn(description: string, cards: NonNullable<TransactionContext["cards"]>): string[] {
	const text = plain(description);
	return cards
		.filter((card) => {
			if (card.last4 && text.includes(card.last4)) return true;
			const words = plain(card.name)
				.split(/[^a-z0-9]+/)
				.filter((w) => w.length >= 4 && !GENERIC_CARD_WORDS.has(w));
			return words.length > 0 && words.every((w) => text.includes(w));
		})
		.map((card) => card.id);
}

export type PaymentCardMatch = { kind: "one"; cardId: string } | { kind: "ambiguous" } | { kind: "none" };

/**
 * De qual cartão é um pagamento de fatura saído da conta. Sinais, do mais seguro ao menos: o total da fatura é
 * igual ao valor (um só cartão); entre vários de mesmo total, o emissor na descrição; sem total, o emissor sozinho.
 * Mais de um candidato sem desempate = `ambiguous` (revisão); nenhum = `none` (cartão não conectado).
 */
export function matchPaymentCard(
	amountCents: number,
	description: string,
	ctx: Pick<TransactionContext, "billTotals" | "cards" | "bills" | "payments">,
	date?: LocalDate,
): PaymentCardMatch {
	// Faturas de QUALQUER conexão: o valor é o total ou o que faltava pagar, e o dia cai a até 5 dias do vencimento.
	const billHits = (ctx.bills ?? []).filter((b) =>
		b.pending
			? matchesOpenBill(b.pending, amountCents, date)
			: (b.totalCents === amountCents || (b.remainingCents > 0 && b.remainingCents === amountCents)) &&
				(date === undefined || b.dueDate === null || Math.abs(daysBetween(b.dueDate, date)) <= BILL_DUE_DAYS),
	);
	const byTotal = [
		...new Set([
			...(ctx.billTotals ?? []).filter((b) => b.amountCents === amountCents).map((b) => b.cardId),
			...billHits.map((b) => b.cardId),
			// Pagamento que o próprio banco registrou na fatura (qualquer conexão, qualquer dia antes do vencimento).
			...(date === undefined
				? []
				: (ctx.payments ?? [])
						.filter(
							(p) =>
								p.amountCents === amountCents && Math.abs(daysBetween(p.date, date)) <= BILL_PAYMENT_DAYS,
						)
						.map((p) => p.cardId)),
		]),
	];
	const named = cardsNamedIn(description, ctx.cards ?? []);
	if (byTotal.length === 1 && byTotal[0] !== undefined) {
		// O emissor da descrição nomeia OUTRO cartão: os dois sinais discordam, não adivinha.
		if (named.length > 0 && !named.includes(byTotal[0])) return { kind: "ambiguous" };
		return { kind: "one", cardId: byTotal[0] };
	}
	if (byTotal.length > 1) {
		const both = named.filter((id) => byTotal.includes(id));
		return both.length === 1 && both[0] !== undefined
			? { kind: "one", cardId: both[0] }
			: { kind: "ambiguous" };
	}
	if (named.length === 1 && named[0] !== undefined) return { kind: "one", cardId: named[0] };
	return named.length > 1 ? { kind: "ambiguous" } : { kind: "none" };
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
	/** Faturas de todos os cartões conectados, de qualquer conexão (total, falta pagar e vencimento). */
	bills?: readonly BillInfo[];
	/** `payments[]` das faturas de TODAS as conexões: um pagamento parcial ou adiantado saído de outra conexão. */
	payments?: readonly BillPayment[];
	/** Os cartões vivos da conexão (nome e final), para ler o emissor na descrição do pagamento da fatura. */
	cards?: readonly { id: string; name: string; last4: string | null }[];
	/** Mês de cada fatura (`billId` → mês do vencimento): vale mais que o cálculo pelo dia de fechamento. */
	billMonths?: ReadonlyMap<string, string>;
	/** As faturas não carregaram: débito da conta e crédito do cartão ficam de fora até carregarem. */
	billsUnavailable?: boolean;
	/**
	 * `connector.isOpenFinance` da conexão. Só no Open Finance regulado o `billForecastDate` é confiável; no MeuPluggy
	 * (`false`) ele vem inconsistente entre bancos (mês de fechamento num, de vencimento noutro), então não decide a fatura.
	 */
	isOpenFinance?: boolean;
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

/** O banco cortou o nome no limite do campo e marcou ("Alisson …", "ALISSON ALV..."). */
const TRUNCATION_MARK = /…|\.{2,}/;

/** Palavras de abertura de Pix/TED/transferência que vêm antes do nome da outra ponta. */
const TRANSFER_LEAD_WORDS = new Set([
	"pix",
	"ted",
	"doc",
	"transf",
	"transfer",
	"transferencia",
	"transferencias",
	"enviado",
	"enviada",
	"enviados",
	"recebido",
	"recebida",
	"recebidos",
	"efetuado",
	"efetuada",
	"realizado",
	"realizada",
	"pelo",
	"pela",
	"via",
	"para",
	"de",
	"do",
	"da",
	"a",
	"o",
	"entre",
	"contas",
	"remetente",
	"destinatario",
	"favorecido",
	"pagador",
	"recebedor",
]);

/**
 * O texto é o nome do titular? Tolerante ao jeito de cada banco escrever: sem caixa, sem acento, com espaços a mais,
 * com o prefixo "PIX ENVIADO/RECEBIDO", "TED", "TRANSF…" na frente e com o nome cortado no fim. Regras:
 * - precisa de ao menos duas palavras (primeiro nome + um sobrenome), todas na ordem do nome do titular;
 * - nome inteiro e igual: vale;
 * - nome mais curto que o do titular só vale se o banco o cortou (reticências) ou se a última palavra é um pedaço da
 *   palavra do titular com pelo menos três palavras ("Alisson Alves Do" para "Alisson Alves Dos Santos");
 * - homônimo parcial ("Maria Silva" x "Maria de Souza Silva"; "Alisson Souza" x "Alisson Alves") não vale.
 */
export function looksLikeOwnerName(
	text: string | null | undefined,
	ownerName: string | null | undefined,
): boolean {
	const owner = personName(ownerName).split(" ").filter(Boolean);
	if (owner.length < 2 || !text) return false;
	const truncated = TRUNCATION_MARK.test(text);
	const words = plain(text)
		.replace(/[^a-z\s]/g, " ")
		.split(/\s+/)
		.filter(Boolean);
	let from = 0;
	while (from < words.length && TRANSFER_LEAD_WORDS.has(words[from] as string)) from += 1;
	const name = words.slice(from);
	if (name.length < 2 || name.length > owner.length) return false;
	const last = name.length - 1;
	for (let i = 0; i < last; i += 1) if (name[i] !== owner[i]) return false;
	const tail = name[last] as string;
	const ownerTail = owner[last] as string;
	if (tail === ownerTail) return name.length === owner.length || truncated;
	return ownerTail.startsWith(tail) && tail.length >= 2 && (truncated || name.length >= 3);
}

/**
 * Transferência para si mesmo pelo NOME: a outra ponta (`paymentData`, ou o que vem na descrição depois de "Pix
 * enviado/recebido", "TED", "TRANSF…") é o titular da conta (`looksLikeOwnerName`). É mais fraco que o CPF, por isso
 * exige nome e sobrenome: homônimo parcial continua sendo gasto.
 */
function isOwnTransferByName(
	tx: PluggyTransaction,
	description: string,
	ownerName: string | null | undefined,
): boolean {
	if (personName(ownerName) === "") return false;
	const side = tx.type === "DEBIT" ? tx.paymentData?.receiver?.name : tx.paymentData?.payer?.name;
	return looksLikeOwnerName(side, ownerName) || looksLikeOwnerName(description, ownerName);
}

/** Valor (centavos) e dia de um lançamento, ou `null` se o Órbita não aceita. Base do casamento com as faturas. */
export function transactionFacts(tx: PluggyTransaction): { amountCents: number; date: LocalDate } | null {
	const amount = amountCentsOf(tx);
	const date = pluggyDateToLocal(tx.date);
	return typeof amount === "number" && date !== null ? { amountCents: amount, date } : null;
}

const FORECAST_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

interface CategoryChoice {
	categoryId: string | null;
	source: CategorySource;
}

/**
 * Categoria de consumo, em ordem: regra do dono → Google Play (Assinaturas) → MCC do estabelecimento → CNAE → categoria do Pluggy → Outros.
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
	// Google Play (Google One, YouTube, F1 TV…): o MCC e a categoria do banco variam por app e erravam (Moradia).
	const digital = isGoogleDigitalCharge(description, merchantName) ? bySlug("assinaturas") : null;
	if (digital) return { categoryId: digital, source: "digital" };
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
 * O dono mexeu neste lançamento (categoria, tipo, data, valor, conta/cartão, ou revisou um pendente)? Então nenhum
 * recálculo da sincronização ou do pareamento (tipo, data do cartão, transferência, pagamento de fatura) o toca.
 */
export const touchedByOwner = (t: { categoryEditedByOwner: boolean; editedByOwner: boolean }) =>
	t.categoryEditedByOwner || t.editedByOwner;

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

/**
 * Lançamento já gravado que a regra do Google Play manda para Assinaturas: o dono não escolheu a categoria
 * (`categoryEditedByOwner`) e ela hoje é outra (Moradia, Outros…). Só despesa e estorno têm categoria de consumo.
 */
export function shouldRecategorizeDigital(
	current: { kind: string; categoryId: string | null; categoryEditedByOwner: boolean },
	next: { categorySource?: CategorySource | undefined; categoryId?: string | null | undefined },
): boolean {
	if (next.categorySource !== "digital" || !next.categoryId) return false;
	if (current.categoryEditedByOwner) return false;
	if (current.kind !== "expense" && current.kind !== "refund") return false;
	return current.categoryId !== next.categoryId;
}

/** Id do grupo de um parcelamento do Pluggy: o mesmo para todas as parcelas da mesma compra, em qualquer sincronização. */
export function pluggyInstallmentGroupId(input: {
	cardId: string;
	purchaseDate: LocalDate;
	count: number;
	description: string;
}): string {
	// O banco escreve o número da parcela no nome ("04/10", "4 de 10", "4-10"): ele muda a cada fatura e não pode
	// entrar no id, senão cada parcela vira um grupo de uma só (e cada grupo estima as seguintes, contando em dobro).
	const ofCount = new RegExp(`\\b\\d{1,2}\\s*(?:de|/|-)\\s*${input.count}\\b`, "gi");
	const name =
		normalizeMerchantName(input.description.replace(ofCount, " ").replace(/\bparc(ela)?\b/gi, " ")) ||
		plain(input.description);
	const hash = createHash("sha256")
		.update(JSON.stringify([input.cardId, input.purchaseDate, input.count, name]))
		.digest("hex");
	return `pluggy-${hash.slice(0, 40)}`;
}

/** Categoria ou descrição que diz estorno/devolução/chargeback ("Estorno compra X", "Devolução Pix", "Refund"). */
const REFUND_TEXT = /\b(refunds?|estornos?|estornad[oa]|devolucao|devolvid[oa]|chargeback)\b/;

/** Crédito na conta que desfaz uma despesa (e não renda). Reembolso de terceiro não entra: pode ser renda de verdade. */
export function isRefundCredit(chain: readonly string[], description: string): boolean {
	return chain.some((name) => REFUND_TEXT.test(name)) || REFUND_TEXT.test(plain(description));
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

/** Rótulo (pt-BR) de `creditCardMetadata.feeType` (docs.pluggy.ai/reference/transactions-list). */
const FEE_LABELS: Readonly<Record<string, string>> = {
	ANNUAL_FEE: "anuidade",
	ATM_WITHDRAWAL_DOMESTIC: "saque no Brasil",
	ATM_WITHDRAWAL_INTERNATIONAL: "saque no exterior",
	EMERGENCY_CREDIT_EVALUATION: "avaliação de crédito emergencial",
	CARD_REISSUE: "segunda via do cartão",
	BILL_PAYMENT_FEE: "pagamento da fatura",
	SMS: "SMS",
};

export const CARD_CREDIT_OPERATION_NOTE =
	"Crédito contratado no cartão (rotativo, parcelamento da fatura ou empréstimo): pode repetir compras que já estão no gasto. Confira.";

/**
 * Sinais de `operationType`/`creditCardMetadata` numa despesa do cartão (docs.pluggy.ai/reference/transactions-list):
 * - TARIFA ou `feeType`: tarifa do cartão; a observação diz qual (anuidade, saque…). Continua despesa;
 * - OPERACOES_CREDITO_CONTRATADAS_CARTAO ou `otherCreditsType` (REVOLVING_CREDIT, BILL_INSTALLMENT, LOAN): o banco lançou
 *   uma operação de crédito, não uma compra. INFERÊNCIA do Órbita (a doc não diz): o valor pode repetir compras já
 *   lançadas, então vai para "Para revisar" (continua contando) em vez de entrar calado.
 */
function cardOperationReview(
	tx: PluggyTransaction,
	note: string | null,
): { note?: string | null; status?: "pending" } {
	const op = normalizeOperationType(tx.operationType);
	const meta = tx.creditCardMetadata;
	if (op === "OPERACOES_CREDITO_CONTRATADAS_CARTAO" || meta?.otherCreditsType) {
		return { note: note ?? CARD_CREDIT_OPERATION_NOTE, status: "pending" };
	}
	if (op === "TARIFA" || meta?.feeType) {
		const label = FEE_LABELS[(meta?.feeType ?? "").toUpperCase()];
		return { note: note ?? (label ? `Tarifa do cartão: ${label}.` : "Tarifa do cartão.") };
	}
	return {};
}

/** Decide o que fazer com um lançamento do Pluggy. Não toca em banco nem em rede. */
export function mapPluggyTransaction(tx: PluggyTransaction, ctx: TransactionContext): MappedTransaction {
	if (tx.type !== "DEBIT" && tx.type !== "CREDIT") return { action: "skip", reason: "invalid" };
	// PENDING (docs.pluggy.ai/docs/transactions, propriedade `status`; docs.pluggy.ai/docs/credit-card-installments):
	// - cartão, DEBIT: compra da fatura ABERTA ("a purchase not yet included in a closed bill"). Entra como despesa
	//   (`bankPending`) pela data da compra; vira POSTED, normalmente com o mesmo id, quando a fatura vence;
	// - conta: "a transaction the institution is still processing or a scheduled payment", com data futura. Não é gasto
	//   ainda (pode nem acontecer, e a Pluggy refaz o vínculo ao liquidar): fica de fora até virar POSTED;
	// - cartão, CREDIT pendente (estorno ou baixa ainda não lançada): fica de fora até virar POSTED.
	const pending = tx.status === "PENDING";
	if (pending && (ctx.accountType !== "CREDIT" || tx.type !== "DEBIT"))
		return { action: "skip", reason: "pending" };
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
		operationType: tx.operationType,
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
		// Âncoras do banco contra recriação com id novo (docs.pluggy.ai/docs/transactions, "Transaction Id can change").
		providerId: tx.providerId ?? null,
		providerCode: tx.providerCode ?? null,
		bankPending: pending,
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
		// "Investido". O resgate (o principal que volta) vira `redemption`: nem renda nem gasto, abate o "Investido". Só o
		// rendimento é receita. Transferência entre contas suas continua de fora (abaixo).
		if (family === "investment" || family === "yield") {
			const categoryId = ctx.categoryIds?.get("investimentos") ?? null;
			if (tx.type === "CREDIT") {
				return {
					action: "upsert",
					externalId: tx.id,
					input: {
						...base,
						kind: family === "yield" ? "income" : "redemption",
						accountId: ctx.accountId,
						categoryId,
					},
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
		// 3) Sem pagamento para casar: pagamento de fatura pelo texto (categoria ou descrição). Liga ao cartão pelo
		// total da fatura (±valor exato) e pelo emissor na descrição; na dúvida, fica para revisão (pendente, fora do
		// gasto); sem cartão nenhum que combine, é o único rastro daquela fatura: conta como "Fatura de cartão".
		if (isCardPayment) {
			if (tx.type === "CREDIT") return { action: "skip", reason: "card_payment" };
			const found = matchPaymentCard(amount, description, ctx, date);
			if (found.kind === "one") {
				return {
					action: "upsert",
					externalId: tx.id,
					input: { ...base, kind: "card_payment", accountId: ctx.accountId, cardId: found.cardId },
				};
			}
			if (found.kind === "ambiguous") {
				return {
					action: "upsert",
					externalId: tx.id,
					input: {
						...base,
						kind: "expense",
						accountId: ctx.accountId,
						status: "pending" as const,
						note: PAYMENT_REVIEW_NOTE,
					},
				};
			}
			return {
				action: "upsert",
				externalId: tx.id,
				input: {
					...base,
					kind: "expense",
					accountId: ctx.accountId,
					note: PAYMENT_UNCONNECTED_NOTE,
					categoryId: ctx.categoryIds?.get(CARD_BILL_SLUG) ?? null,
				},
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
		// Estorno ou devolução que caiu na conta (compra no débito, Pix devolvido): desfaz a despesa original, não é
		// renda. O sync procura a despesa; sem ela o crédito espera a próxima rodada (como o estorno do cartão).
		if (tx.type === "CREDIT" && isRefundCredit(chain, description)) {
			const refundChoice = choose();
			return {
				action: "refund",
				externalId: tx.id,
				input: { ...base, kind: "refund", accountId: ctx.accountId, categoryId: refundChoice.categoryId },
				categorySource: refundChoice.source,
				original: { amountCents: amount, description, date },
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
	const billMonth = meta?.billId ? ctx.billMonths?.get(meta.billId) : undefined;
	// `billForecastDate` ("provided for pending and future transactions too", docs.pluggy.ai/reference/transactions-list)
	// só vale em conector Open Finance. Nos dados reais do MeuPluggy ele não segue convenção (Santander: mês do
	// fechamento; Nubank: mês do vencimento; Inter: o da fatura que já fechou), então lá a fatura vem do fechamento.
	const forecast =
		ctx.isOpenFinance !== false && meta?.billForecastDate && FORECAST_MONTH.test(meta.billForecastDate)
			? meta.billForecastDate
			: null;
	// Compra PENDING sem `billId` = "not yet included in a closed bill" (docs): cai na fatura em que o banco vai lançá-la.
	// `billPostDate` é o dia em que ela entra na fatura; sem ele, vale o dia do lançamento. Parcela pendente não pode
	// usar a data da compra (meses atrás). O dia do fechamento segue a regra do cartão (`closingRule`), que o sync deduz
	// das faturas do próprio cartão (`inferClosingRule`); sem evidência não há deslocamento de um dia.
	const postDate = meta?.billPostDate ? pluggyDateToLocal(meta.billPostDate) : null;
	const invoiceRef = pending && postDate !== null && !billMonth ? postDate : date;
	const invoiceMonth = billMonth ?? forecast ?? invoiceFor(invoiceRef, ctx.card.config).month;
	const invoiceFromBank = billMonth !== undefined || forecast !== null;
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
		// A data da compra só vale se não vier depois do lançamento (compra no futuro é dado torto).
		const purchaseDay = purchaseDate !== null && purchaseDate <= date ? purchaseDate : null;
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
				// Data e mês do gasto pela COMPRA, nunca pelo dia em que a fatura lançou (o `date` do Pluggy no cartão pode ser
				// a data da fatura): parcela = mês da compra + n − 1; compra à vista = mês da compra.
				date: groupInput ? groupInput.date : (purchaseDay ?? date),
				budgetMonth: groupInput ? groupInput.budgetMonth : monthOf(purchaseDay ?? date),
				kind: "expense",
				cardId: ctx.card.id,
				invoiceMonth,
				note,
				categoryId: choice.categoryId,
				...cardOperationReview(tx, note),
			},
			categorySource: choice.source,
			...(groupInput ? { installment: groupInput.installment } : {}),
			...(invoiceFromBank ? { invoiceFromBill: true as const } : {}),
		};
	}
	// Crédito no cartão. ESTORNO/CASHBACK (`operationType`) são crédito que abate a fatura. Todo o resto que parece baixa
	// de fatura NUNCA vira estorno: o `operationType` não serve (PAGAMENTO é também compra; Inter e Santander o usam na
	// baixa, com categoria Shopping ou Credit card payment), então valem a categoria, a descrição ("pagamento on line",
	// "pagamento de fatura", "pagamento recebido") e o valor igual a um pagamento registrado em `/bills` deste cartão.
	const cardSignal = operationSignal(tx.operationType, "in");
	if (cardSignal === "card_payment") return { action: "skip", reason: "card_payment" };
	if (cardSignal !== "refund") {
		if (ctx.billsUnavailable) return { action: "skip", reason: "bills_unavailable" };
		// `billPaymentMatches` já casou, um a um, os créditos com os `payments[]` do cartão (valor e dia): vale para o que
		// vier com qualquer rótulo. (Não basta "valor igual a um pagamento": um estorno real de mesmo valor não é baixa.)
		if (
			ctx.billPaymentMatches?.has(tx.id) ||
			isCardSidePayment({ chain, description, operationType: tx.operationType })
		) {
			return { action: "skip", reason: "card_payment" };
		}
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
