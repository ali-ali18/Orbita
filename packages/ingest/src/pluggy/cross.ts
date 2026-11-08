import { addDays, daysBetween, type LocalDate } from "@orbita/core";
import type { Stores, TransactionFilter, TransactionRecord } from "@orbita/db";
import {
	type BillInfo,
	matchPaymentCard,
	PAYMENT_REVIEW_NOTE,
	PAYMENT_UNCONNECTED_NOTE,
	PLUGGY_SOURCE,
} from "./mapping.ts";

/*
 * Passo final da sincronização, DEPOIS de todas as conexões. Cada banco do Meu Pluggy é uma conexão separada, e a
 * sincronização de uma conexão só enxerga as próprias contas e cartões. Aqui o dado já está no banco, de todas elas:
 * - pagamento de fatura de um cartão de OUTRA conexão (a conta do Mercado Pago paga o cartão do Mercado Pago, que pode
 *   ser outra conexão) é ligado ao cartão certo; só vira "Fatura de cartão" o que nenhum cartão conectado explica;
 * - saída de uma conta e entrada de mesmo valor em OUTRA conta sua, no mesmo dia ou no seguinte, viram transferência
 *   própria (nem gasto nem receita) quando o par é único, mesmo sem o nome do titular na descrição.
 * Tudo idempotente: depois de corrigido, a linha já não casa de novo. Linha que o dono editou nunca é tocada.
 */

/** Quantos dias para trás o passo olha (a mesma janela mínima da sincronização). */
export const CROSS_WINDOW_DAYS = 122;

export const RECOMPUTED_TRANSFER_NOTE = "Recalculado: transferência entre contas suas.";

type TransactionStore = Stores["transactions"];

export const isPaymentNote = (note: string | null) =>
	note === PAYMENT_UNCONNECTED_NOTE || note === PAYMENT_REVIEW_NOTE;

/**
 * Uma ponta de transferência própria: o dinheiro que saiu (`out`) ou entrou (`in`) numa conta do Órbita.
 * `unknown`: transferência já gravada, cujo sentido o banco de dados não guarda (casa com qualquer sentido).
 */
export interface OwnTransferLeg {
	id: string;
	accountId: string;
	direction: "in" | "out" | "unknown";
	amountCents: number;
	date: LocalDate;
}

/** Id de uma ponta → id da outra, só para pares ÚNICOS dos dois lados (na dúvida não pareia). */
export function pairLegs(legs: readonly OwnTransferLeg[]): Map<string, string> {
	const candidates = (leg: OwnTransferLeg) =>
		legs.filter(
			(other) =>
				other.id !== leg.id &&
				(other.direction === "unknown" || leg.direction === "unknown" || other.direction !== leg.direction) &&
				other.accountId !== leg.accountId &&
				other.amountCents === leg.amountCents &&
				Math.abs(daysBetween(leg.date, other.date)) <= 1,
		);
	const paired = new Map<string, string>();
	for (const leg of legs) {
		if (paired.has(leg.id)) continue;
		const [only, ...rest] = candidates(leg);
		if (!only || rest.length > 0) continue;
		const back = candidates(only);
		if (back.length !== 1 || back[0]?.id !== leg.id) continue;
		paired.set(leg.id, only.id);
		paired.set(only.id, leg.id);
	}
	return paired;
}

/** Como `pairLegs`, devolvendo a conta da outra ponta: `id da ponta → conta da outra ponta`. */
export function pairOwnTransfers(legs: readonly OwnTransferLeg[]): Map<string, string> {
	const accountOf = new Map(legs.map((l) => [l.id, l.accountId]));
	const out = new Map<string, string>();
	for (const [id, other] of pairLegs(legs)) out.set(id, accountOf.get(other) as string);
	return out;
}

async function listAll(
	transactions: TransactionStore,
	filter: TransactionFilter,
): Promise<TransactionRecord[]> {
	const out: TransactionRecord[] = [];
	let before: { date: LocalDate; id: string } | undefined;
	for (;;) {
		const page = await transactions.listRecent({ limit: 500, filter, ...(before ? { before } : {}) });
		out.push(...page);
		const last = page[page.length - 1];
		if (page.length < 500 || !last) return out;
		before = { date: last.date, id: last.id };
	}
}

export interface CrossInput {
	transactions: TransactionStore;
	today: LocalDate;
	/** Cartões vivos de TODAS as conexões. */
	cards: readonly { id: string; name: string; last4: string | null }[];
	/** Faturas de todos os cartões conectados. */
	bills: readonly BillInfo[];
}

export interface CrossResult {
	billPayments: number;
	ownTransfers: number;
}

/** Roda os dois passos. Devolve quantas linhas foram corrigidas em cada um. */
export async function reconcileAcrossConnections(input: CrossInput): Promise<CrossResult> {
	const from = addDays(input.today, -CROSS_WINDOW_DAYS);
	const billPayments = await relinkBillPayments(input, from);
	const ownTransfers = await pairAcrossAccounts(input.transactions, from);
	return { billPayments, ownTransfers };
}

/**
 * Pagamentos que ficaram em "Fatura de cartão" (cartão não conectado) ou em revisão porque a conexão deles só via os
 * próprios cartões: procura entre os cartões de todas as conexões. Um só candidato vira `card_payment`; ambíguo vai
 * para revisão; nenhum, fica como está.
 */
async function relinkBillPayments(input: CrossInput, from: LocalDate): Promise<number> {
	const { transactions } = input;
	const rows = await listAll(transactions, { kinds: ["expense"], sources: [PLUGGY_SOURCE], from });
	let changed = 0;
	for (const row of rows) {
		if (row.categoryEditedByOwner || row.accountId === null || !isPaymentNote(row.note)) continue;
		const found = matchPaymentCard(row.amountCents, row.description, input, row.date);
		if (found.kind === "one") {
			await transactions.update(row.id, {
				kind: "card_payment",
				cardId: found.cardId,
				counterpartAccountId: null,
				categoryId: null,
				status: "confirmed",
				note: null,
			});
			changed += 1;
		} else if (found.kind === "ambiguous" && row.note === PAYMENT_UNCONNECTED_NOTE) {
			await transactions.update(row.id, {
				status: "pending",
				note: PAYMENT_REVIEW_NOTE,
				categoryId: null,
			});
			changed += 1;
		}
	}
	return changed;
}

/** Pareia saídas e entradas de contas diferentes (de qualquer conexão) e marca as duas pontas como `transfer`. */
async function pairAcrossAccounts(transactions: TransactionStore, from: LocalDate): Promise<number> {
	const rows = await listAll(transactions, {
		kinds: ["expense", "income", "transfer"],
		sources: [PLUGGY_SOURCE],
		from,
	});
	const byId = new Map<string, TransactionRecord>();
	const legs: OwnTransferLeg[] = [];
	for (const row of rows) {
		// Pagamento de fatura em revisão ou na categoria "Fatura de cartão" não é ponta de transferência.
		if (row.accountId === null || row.cardId !== null || isPaymentNote(row.note)) continue;
		byId.set(row.id, row);
		legs.push({
			id: row.id,
			accountId: row.accountId,
			direction: row.kind === "income" ? "in" : row.kind === "expense" ? "out" : "unknown",
			amountCents: row.amountCents,
			date: row.date,
		});
	}
	const pairs = pairLegs(legs);
	let changed = 0;
	for (const [id, partnerId] of pairs) {
		const row = byId.get(id);
		const partner = byId.get(partnerId);
		if (!row || !partner || partner.accountId === null) continue;
		// O dono mexeu em uma das pontas: o par fica como está.
		if (row.categoryEditedByOwner || partner.categoryEditedByOwner) continue;
		if (row.kind === "transfer") {
			if (row.counterpartAccountId === null) {
				await transactions.update(id, { counterpartAccountId: partner.accountId });
				changed += 1;
			}
			continue;
		}
		await transactions.update(id, {
			kind: "transfer",
			counterpartAccountId: partner.accountId,
			...(row.note === null ? { note: RECOMPUTED_TRANSFER_NOTE } : {}),
		});
		changed += 1;
	}
	return changed;
}
