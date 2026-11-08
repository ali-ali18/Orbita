import type { Cents } from "@orbita/core";
import {
	type BudgetBefore,
	DEFAULT_PLAN_RESERVE_PERCENT,
	type IncomeSourceCreateBody,
	type IncomeSourceDto,
	type IncomeSourceUpdateBody,
	MAX_CENTS,
	type PlanDto,
} from "@orbita/shared";
import { chartSeries } from "@orbita/tokens";
import { money, monthYear, pluralDays } from "../../lib/format.ts";

/*
 * Lógica pura de "Renda" e do plano do mês. Nenhuma conta de dinheiro aqui: o plano, o próximo pagamento e o ajuste
 * dos limites vêm do servidor (engine). O app valida o formulário, escolhe textos e organiza as linhas.
 */

export const NEXT_PAYDAY_NONE = null;

export interface IncomeForm {
	name: string;
	amountCents: Cents;
	/** Dia do mês (1 a 31). */
	payday: number;
	accountId: string | null;
	/** `true` = todo mês (salário); `false` = só em `month` (freela). */
	recurring: boolean;
	/** AAAA-MM; só vale quando `recurring` é falso. */
	month: string;
}

export const initialIncomeForm = (month: string, firstSource: boolean): IncomeForm => ({
	name: firstSource ? "Salário" : "",
	amountCents: 0,
	payday: 5,
	accountId: null,
	recurring: firstSource,
	month,
});

export const formFromSource = (s: IncomeSourceDto, fallbackMonth: string): IncomeForm => ({
	name: s.name,
	amountCents: s.amountCents,
	payday: s.payday,
	accountId: s.accountId,
	recurring: s.recurring,
	month: s.month ?? fallbackMonth,
});

export function validateIncomeForm(form: IncomeForm): string | null {
	const name = form.name.trim();
	if (name === "") return "Dê um nome para a renda.";
	if (name.length > 60) return "O nome passa de 60 letras.";
	if (form.amountCents <= 0) return "Informe quanto você recebe.";
	if (form.amountCents > MAX_CENTS) return "O valor passa do limite aceito.";
	if (!Number.isInteger(form.payday) || form.payday < 1 || form.payday > 31) {
		return "O dia do pagamento vai de 1 a 31.";
	}
	return null;
}

export type IncomeRequest =
	| { type: "create"; body: IncomeSourceCreateBody }
	| { type: "update"; id: string; body: IncomeSourceUpdateBody };

export function buildIncomeRequest(input: {
	form: IncomeForm;
	editingId: string | null;
}): { ok: true; request: IncomeRequest } | { ok: false; message: string } {
	const { form, editingId } = input;
	const message = validateIncomeForm(form);
	if (message) return { ok: false, message };
	const common = {
		name: form.name.trim(),
		amountCents: form.amountCents,
		payday: form.payday,
		recurring: form.recurring,
	};
	if (editingId === null) {
		const body: IncomeSourceCreateBody = {
			...common,
			...(form.accountId ? { accountId: form.accountId } : {}),
			...(form.recurring ? {} : { month: form.month }),
		};
		return { ok: true, request: { type: "create", body } };
	}
	const body: IncomeSourceUpdateBody = {
		...common,
		accountId: form.accountId,
		month: form.recurring ? null : form.month,
	};
	return { ok: true, request: { type: "update", id: editingId, body } };
}

/** "Todo mês · dia 5" / "Só em novembro de 2026 · dia 20". */
export function sourceCaption(s: Pick<IncomeSourceDto, "recurring" | "month" | "payday">): string {
	const when = s.recurring || s.month === null ? "Todo mês" : `Só em ${monthYear(s.month)}`;
	return `${when} · dia ${s.payday}`;
}

/** "Salário cai hoje", "Salário cai amanhã", "Salário cai em 20 dias". O nome vem da própria renda. */
export function paydayLine(name: string, daysUntil: number): string {
	if (daysUntil <= 0) return `${name} cai hoje`;
	if (daysUntil === 1) return `${name} cai amanhã`;
	return `${name} cai em ${pluralDays(daysUntil)}`;
}

/** Salvar ou arquivar renda muda a lista, o plano, a sugestão do orçamento e o Início. */
export function isAffectedByIncome(queryKey: readonly unknown[], baseUrl: string): boolean {
	return (
		queryKey[0] === baseUrl &&
		(queryKey[1] === "income" ||
			queryKey[1] === "plan" ||
			queryKey[1] === "budgets" ||
			queryKey[1] === "summary")
	);
}

// ------------------------------------------------------------------- plano

export const RESERVE_OPTIONS = [0, 5, 10, 15, 20] as const;
export { DEFAULT_PLAN_RESERVE_PERCENT };

export interface PlanRow {
	key: "commitments" | "daily" | "goals" | "reserve" | "left";
	label: string;
	caption: string | null;
	cents: Cents;
	/** Cor da marca na barra (paleta dos gráficos; nunca no texto). */
	color: string;
}

/** As linhas do card, na ordem do Figma: o que é fixo, o dia a dia, as metas, a reserva e o que sobra. */
export function planRows(
	plan: Pick<PlanDto, "buckets" | "reservePercent" | "goals" | "commitments">,
): PlanRow[] {
	const b = plan.buckets;
	const commitments = plan.commitments.length;
	return [
		{
			key: "commitments",
			label: "Compromissos fixos",
			caption:
				commitments === 0
					? "Assinaturas e parcelas"
					: `${commitments} ${commitments === 1 ? "item" : "itens"}`,
			cents: b.commitmentsCents,
			color: chartSeries[5] ?? "",
		},
		{
			key: "daily",
			label: "Dia a dia",
			caption: "Pelo que você costuma gastar",
			cents: b.dailyCents,
			color: chartSeries[0] ?? "",
		},
		{
			key: "goals",
			label: "Metas",
			caption:
				plan.goals.length === 0
					? "Nenhuma meta com prazo"
					: `${plan.goals.length} ${plan.goals.length === 1 ? "meta" : "metas"}`,
			cents: b.goalsCents,
			color: chartSeries[3] ?? "",
		},
		{
			key: "reserve",
			label: "Reserva",
			caption: `${plan.reservePercent}% da renda`,
			cents: b.reserveCents,
			color: chartSeries[2] ?? "",
		},
		{
			key: "left",
			label: "Sobra",
			caption: b.leftCents < 0 ? "Falta para fechar o mês" : null,
			cents: b.leftCents,
			color: chartSeries[9] ?? "",
		},
	];
}

/** Partes da barra: só o que é positivo; o app não calcula, só repassa os pesos do servidor. */
export function planBarParts(
	rows: readonly PlanRow[],
): Array<{ key: string; color: string; weight: number }> {
	return rows.filter((r) => r.cents > 0).map((r) => ({ key: r.key, color: r.color, weight: r.cents }));
}

/** O plano pode ser aplicado: há plano viável com algum limite. */
export const canApplyPlan = (plan: Pick<PlanDto, "feasible" | "budget">): boolean =>
	plan.feasible && plan.budget.totalCents > 0;

/** Texto da confirmação quando aplicar troca limites que o dono já definiu. */
export function replaceMessage(count: number): string {
	return `${count === 1 ? "1 limite que você definiu será trocado ou removido" : `${count} limites que você definiu serão trocados ou removidos`} pelo plano. Dá para desfazer logo depois.`;
}

/** Depois de aplicar: "Orçamento atualizado: R$ 2.070,00 no mês." */
export const appliedMessage = (totalCents: Cents, hidden = false): string =>
	`Orçamento atualizado: ${money(totalCents, hidden, { sign: "never" })} no mês.`;

// ----------------------------------------------------------- orçamento x renda

/** Aviso (sem bloquear) quando o limite do mês passa da renda cadastrada. */
export function aboveIncomeWarning(
	totalCents: Cents | null,
	incomeCents: Cents,
	hidden = false,
): string | null {
	if (totalCents === null || incomeCents <= 0 || totalCents <= incomeCents) return null;
	return `Esse limite está acima da sua renda de ${money(incomeCents, hidden, { sign: "never" })}.`;
}

const HIDDEN_WARNING: Partial<Record<PlanDto["warnings"][number]["code"], string>> = {
	commitments_exceed_income: "Seus compromissos passam da renda.",
	scaled_to_fit: "Ajustei os limites para caber na sua renda.",
};

/** Texto do aviso do plano; com o olho fechado, a versão sem valores (o do servidor cita reais). */
export function planWarningText(warning: PlanDto["warnings"][number], hidden: boolean): string {
	return hidden ? (HIDDEN_WARNING[warning.code] ?? warning.message) : warning.message;
}

/** O que o Desfazer manda de volta ao servidor. */
export const restoreBody = (previous: readonly BudgetBefore[]) => ({ previous: [...previous] });

/** Há o que desfazer? (Ajustar sem mudança devolve lista vazia.) */
export const hasUndo = (previous: readonly BudgetBefore[]): boolean => previous.length > 0;
