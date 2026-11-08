import { addMonths, type Cents, type LocalDate, monthOf } from "@orbita/core";
import { type RecurrenceCreateBody, recurrenceCreateBody } from "@orbita/shared";
import { monthName } from "../../lib/format.ts";
import type { DetailTransaction } from "./detail-model.ts";

/*
 * Lógica pura de "Repetir" no detalhe do lançamento: o lançamento vira uma recorrência (o mesmo módulo que as
 * Assinaturas usam) com o valor, o nome, a categoria, a conta ou cartão e o dia dele. Nenhuma conta de dinheiro:
 * o valor é o do lançamento, em centavos.
 */

const NAME_MAX = 60;

type Repeatable = Pick<DetailTransaction, "kind" | "installmentGroupId">;

/** Despesa ou receita avulsa. Parcela já tem fim e as outras (transferência, fatura, estorno) não são recorrência. */
export function canRepeat(t: Repeatable): boolean {
	return (t.kind === "expense" || t.kind === "income") && t.installmentGroupId === null;
}

/**
 * A recorrência começa no mês seguinte ao do lançamento (ou ao de hoje, se o lançamento é mais antigo): o deste
 * mês já existe e não deve ser contado duas vezes. Sempre dia 1; o dia da cobrança é `dayOfMonth`.
 */
export function repeatStartDate(date: LocalDate, today: LocalDate): LocalDate {
	const base = date > today ? date : today;
	return `${addMonths(monthOf(base), 1)}-01`;
}

/** O dia do mês do lançamento (1 a 31). */
export function repeatDay(date: LocalDate): number {
	return Number(date.slice(8, 10));
}

export interface RepeatPlan {
	body: RecurrenceCreateBody;
	/** "Todo dia 6" */
	dayLabel: string;
	/** "dezembro" ou "dezembro de 2027" */
	startLabel: string;
}

export type RepeatResult = { ok: true; plan: RepeatPlan } | { ok: false; message: string };

type RepeatSource = Pick<
	DetailTransaction,
	| "kind"
	| "installmentGroupId"
	| "amountCents"
	| "date"
	| "description"
	| "categoryId"
	| "accountId"
	| "cardId"
>;

/** Pedido de nova recorrência a partir do lançamento, validado com o mesmo schema da API. */
export function buildRepeat(t: RepeatSource, today: LocalDate): RepeatResult {
	if (!canRepeat(t)) return { ok: false, message: "Este tipo de lançamento não pode se repetir." };
	const startDate = repeatStartDate(t.date, today);
	const day = repeatDay(t.date);
	const where = t.cardId ? { cardId: t.cardId } : { accountId: t.accountId };
	const parsed = recurrenceCreateBody.safeParse({
		kind: t.kind,
		name: t.description.trim().slice(0, NAME_MAX).trim(),
		amountCents: t.amountCents as Cents,
		dayOfMonth: day,
		startDate,
		...(t.categoryId ? { categoryId: t.categoryId } : {}),
		...where,
	});
	if (!parsed.success) {
		return { ok: false, message: parsed.error.issues[0]?.message ?? "Confira os dados do lançamento." };
	}
	const month = startDate.slice(0, 7);
	const name = monthName(month).toLocaleLowerCase("pt-BR");
	return {
		ok: true,
		plan: {
			body: parsed.data,
			dayLabel: `Todo dia ${day}`,
			startLabel: month.slice(0, 4) === today.slice(0, 4) ? name : `${name} de ${month.slice(0, 4)}`,
		},
	};
}

/** Confirmação depois de salvar: "Vai repetir todo dia 6, a partir de dezembro." */
export function repeatedMessage(plan: Pick<RepeatPlan, "dayLabel" | "startLabel">): string {
	return `Vai repetir ${plan.dayLabel.toLocaleLowerCase("pt-BR")}, a partir de ${plan.startLabel}.`;
}
