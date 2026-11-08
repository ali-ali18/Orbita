import {
	addMonths,
	type Cents,
	clampDayInMonth,
	type LocalDate,
	type MonthKey,
	monthlyNeeded,
	monthOf,
} from "@orbita/core";
import {
	DEFAULT_GOAL_ICON,
	GOAL_CHART_SLOTS,
	GOAL_ICONS,
	type GoalCreateBody,
	type GoalIcon,
	type GoalUpdateBody,
	MAX_CENTS,
} from "@orbita/shared";
import { chartSeries } from "@orbita/tokens";
import { formatWholeReais, monthName, monthYear } from "../../lib/format.ts";
import type { IconName } from "../../ui/index.ts";

/*
 * Lógica pura das telas de metas: textos, formulário e o corpo dos pedidos. Os números (guardado, percentual,
 * valor mensal, projeção, situação) vêm prontos da API, calculados pelo engine; aqui só se mostra. A única
 * conta feita no app é a prévia do "Você precisa guardar" no formulário, com a mesma função do engine
 * (`monthlyNeeded`), porque a meta ainda não existe no servidor.
 */

export interface GoalLike {
	id: string;
	name: string;
	targetCents: Cents;
	deadline: LocalDate | null;
	accountId: string | null;
	icon: GoalIcon;
	chartSlot: number;
	savedCents: Cents;
	remainingCents: Cents;
	percent: number;
	reached: boolean;
	monthsLeft: number | null;
	monthlyNeededCents: Cents | null;
	projectedDate: LocalDate | null;
	status: "reached" | "no_deadline" | "on_track" | "behind";
}

// ---------------------------------------------------------------- aparência

const ICONS: Record<GoalIcon, IconName> = {
	target: "alvo",
	plane: "aviao",
	shield: "escudo",
	monitor: "monitor",
	home: "inicio",
	car: "transporte",
	heart: "coracao",
	gift: "presente",
};

export const ICON_LABELS: Record<GoalIcon, string> = {
	target: "Alvo",
	plane: "Viagem",
	shield: "Reserva",
	monitor: "Computador",
	home: "Casa",
	car: "Carro",
	heart: "Saúde",
	gift: "Presente",
};

/** Os espaços da paleta, em ordem (as opções de cor do formulário). */
export const GOAL_SLOTS = Array.from({ length: GOAL_CHART_SLOTS }, (_, i) => i);

export const goalIcon = (icon: GoalIcon): IconName => ICONS[icon] ?? ICONS[DEFAULT_GOAL_ICON];

/** Cor da meta: o espaço dela na paleta dos gráficos (nunca um valor solto). */
export function goalColor(chartSlot: number): string {
	return chartSeries[chartSlot] ?? (chartSeries[0] as string);
}

/** Barra de progresso: de 0 a 100, e nunca some por completo quando já tem algo guardado. */
export function barWeights(percent: number): { done: number; rest: number } {
	const done = Math.min(100, Math.max(0, Math.round(percent)));
	return { done, rest: 100 - done };
}

// -------------------------------------------------------------------- textos

export function statusLabel(status: GoalLike["status"]): string {
	switch (status) {
		case "reached":
			return "Atingida";
		case "on_track":
			return "No ritmo";
		case "behind":
			return "Atrasada";
		case "no_deadline":
			return "Sem prazo";
	}
}

/** "R$ 737 por mês" (reais cheios; só com inteiros). */
export const perMonth = (cents: Cents): string => `${formatWholeReais(cents)} por mês`;

/** O mês do prazo: "julho de 2027". */
export const deadlineMonthLabel = (deadline: LocalDate): string => monthYear(monthOf(deadline));

/** "Julho de 2027" (título de opção; o texto corrido usa minúscula). */
export const monthTitle = (month: MonthKey): string => `${monthName(month)} de ${month.slice(0, 4)}`;

/** Legenda do cartão: "Até julho de 2027 · R$ 737 por mês", "Até março de 2027" (atingida), "Sem prazo". */
export function goalCaption(goal: Pick<GoalLike, "deadline" | "reached" | "monthlyNeededCents">): string {
	if (goal.deadline === null) return "Sem prazo";
	const until = `Até ${deadlineMonthLabel(goal.deadline)}`;
	if (goal.reached || goal.monthlyNeededCents === null) return until;
	return `${until} · ${perMonth(goal.monthlyNeededCents)}`;
}

export function countLabel(n: number): string {
	return n === 1 ? "1 meta" : `${n} metas`;
}

/** "de R$ 12.000,00 somando as 3 metas". */
export function totalsCaption(targetFormatted: string, count: number): string {
	return `de ${targetFormatted} somando ${count === 1 ? "a meta" : `as ${count} metas`}`;
}

/** Projeção no ritmo atual: "No ritmo de agora, termina em outubro de 2027". */
export function projectionLabel(goal: Pick<GoalLike, "projectedDate" | "reached" | "status">): string | null {
	if (goal.reached) return null;
	if (goal.projectedDate === null) return "Guarde um valor para eu estimar quando termina.";
	return `No ritmo de agora, termina em ${monthYear(monthOf(goal.projectedDate))}.`;
}

export const EMPTY_TEXT =
	"Nenhuma meta ainda. Crie uma para uma viagem, uma reserva ou uma compra e acompanhe quanto já guardou.";
export const NO_MONEY_MOVES =
	"Guardar aqui só registra quanto você já separou: nenhum dinheiro sai da sua conta por esta tela.";

// ----------------------------------------------------------------- formulário

export interface GoalForm {
	name: string;
	targetCents: Cents;
	/** Mês do prazo (o prazo vale até o último dia dele); `null` = sem prazo. */
	deadlineMonth: MonthKey | null;
	icon: GoalIcon;
	chartSlot: number;
	/** Conta onde o dinheiro está guardado; `null` = nenhuma. */
	accountId: string | null;
}

/** Cor inicial: a próxima depois das que as metas existentes já usam (a paleta gira). */
export function nextChartSlot(used: readonly number[]): number {
	for (let slot = 0; slot < GOAL_CHART_SLOTS; slot++) if (!used.includes(slot)) return slot;
	return used.length % GOAL_CHART_SLOTS;
}

export function initialForm(usedSlots: readonly number[] = []): GoalForm {
	return {
		name: "",
		targetCents: 0,
		deadlineMonth: null,
		icon: DEFAULT_GOAL_ICON,
		chartSlot: nextChartSlot(usedSlots),
		accountId: null,
	};
}

export function formFromGoal(goal: GoalLike): GoalForm {
	return {
		name: goal.name,
		targetCents: goal.targetCents,
		deadlineMonth: goal.deadline === null ? null : monthOf(goal.deadline),
		icon: goal.icon,
		chartSlot: goal.chartSlot,
		accountId: goal.accountId,
	};
}

/** Prazo salvo = o último dia do mês escolhido. */
export const deadlineOf = (month: MonthKey): LocalDate => clampDayInMonth(month, 31);

/** Meses oferecidos em "Até quando": do mês corrente aos próximos 4 anos (inclui o corrente). */
export function deadlineOptions(month: MonthKey, count = 49): MonthKey[] {
	return Array.from({ length: count }, (_, i) => addMonths(month, i));
}

export function validateForm(form: GoalForm): string | null {
	const name = form.name.trim();
	if (name === "") return "Dê um nome para a meta.";
	if (name.length > 60) return "O nome passa de 60 letras.";
	if (form.targetCents <= 0) return "Informe quanto quer guardar.";
	if (form.targetCents > MAX_CENTS) return "O valor passa do limite aceito.";
	if (!GOAL_ICONS.includes(form.icon)) return "Escolha um ícone da lista.";
	return null;
}

export type SaveRequest =
	| { type: "create"; body: GoalCreateBody }
	| { type: "update"; id: string; body: GoalUpdateBody };

export function buildRequest(input: {
	form: GoalForm;
	editingId: string | null;
}): { ok: true; request: SaveRequest } | { ok: false; message: string } {
	const { form, editingId } = input;
	const message = validateForm(form);
	if (message) return { ok: false, message };
	const deadline = form.deadlineMonth === null ? null : deadlineOf(form.deadlineMonth);
	const common = {
		name: form.name.trim(),
		targetCents: form.targetCents,
		deadline,
		accountId: form.accountId,
		icon: form.icon,
		chartSlot: form.chartSlot,
	};
	return editingId === null
		? { ok: true, request: { type: "create", body: common } }
		: { ok: true, request: { type: "update", id: editingId, body: common } };
}

/**
 * Prévia do "Você precisa guardar" enquanto o dono preenche: a mesma conta do engine (`monthlyNeeded`) sobre o
 * que já foi guardado (na criação, nada). `null` sem valor ou sem prazo.
 */
export function previewMonthly(input: {
	form: Pick<GoalForm, "targetCents" | "deadlineMonth">;
	savedCents: Cents;
	today: LocalDate;
}): { monthlyCents: Cents; monthsLeft: number } | null {
	const { form, savedCents, today } = input;
	if (form.targetCents <= 0 || form.deadlineMonth === null) return null;
	const remainingCents = Math.max(0, form.targetCents - savedCents);
	const { monthlyCents, monthsLeft } = monthlyNeeded({
		remainingCents,
		deadline: deadlineOf(form.deadlineMonth),
		today,
	});
	return { monthlyCents, monthsLeft };
}

export function previewText(preview: { monthlyCents: Cents } | null, hasTarget: boolean): string {
	if (preview) return perMonth(preview.monthlyCents);
	return hasTarget ? "Sem prazo, sem valor por mês" : "Informe o valor e o prazo";
}

/** Prazo no passado não faz sentido ao criar; a edição aceita o que já existe. */
export const isPastMonth = (month: MonthKey, current: MonthKey): boolean => month < current;

// ------------------------------------------------------------------- dados

/** Guardar ou apagar um valor muda a lista, o detalhe e a sobra escolhida. */
export function isAffectedByGoals(queryKey: readonly unknown[], baseUrl: string): boolean {
	return queryKey[0] === baseUrl && (queryKey[1] === "goals" || queryKey[1] === "preferences");
}

/** Metas ativas em que dá para escolher "Sobra do mês vai para". */
export const selectableGoals = <T extends { archivedAt: string | null }>(goals: readonly T[]): T[] =>
	goals.filter((g) => g.archivedAt === null);
