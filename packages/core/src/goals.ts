import { addMonths, clampDayInMonth, monthOf, parseLocalDate, parseMonthKey } from "./dates.ts";
import { assertCents, sumCents } from "./money.ts";
import type { Cents, LocalDate, MonthKey } from "./types.ts";

/** Projeção além de 100 anos não é previsão, é ruído (e sairia do calendário): vira "sem projeção". */
export const GOAL_MAX_PROJECTION_MONTHS = 1200;

/** Quantos meses recentes entram no ritmo (a média não se deixa levar por um mês só). */
export const GOAL_PACE_MONTHS = 3;

export interface GoalContribution {
	amountCents: Cents;
	date: LocalDate;
}

export interface GoalInput {
	targetCents: Cents;
	/** Prazo; `null` = meta sem prazo. */
	deadline: LocalDate | null;
	/** Dia em que a meta foi criada: de onde o ritmo começa a contar. */
	createdOn: LocalDate;
	contributions: readonly GoalContribution[];
}

/**
 * - `reached`: guardou tudo.
 * - `no_deadline`: sem prazo, não há ritmo a cobrar.
 * - `on_track`: o ritmo atual termina até o prazo.
 * - `behind`: no ritmo atual não dá tempo (ou o prazo já passou).
 */
export type GoalStatus = "reached" | "no_deadline" | "on_track" | "behind";

export interface GoalSummary {
	savedCents: Cents;
	/** Quanto falta (0 quando atingida). */
	remainingCents: Cents;
	/** 0 a 100, inteiro, arredondado para baixo: só chega a 100 quando a meta é atingida. */
	percent: number;
	reached: boolean;
	/** Meses até o prazo (mínimo 1 no mês do prazo); 0 com prazo vencido; `null` sem prazo ou atingida. */
	monthsLeft: number | null;
	/** Quanto guardar por mês para chegar ao prazo (arredondado para cima); `null` sem prazo; 0 se atingida. */
	monthlyNeededCents: Cents | null;
	/** Média mensal guardada nos últimos meses (para baixo). */
	paceCents: Cents;
	/** Quando termina no ritmo atual; `null` se o ritmo é zero ou a previsão passa de 100 anos. Hoje, se já atingida. */
	projectedDate: LocalDate | null;
	status: GoalStatus;
}

const monthIndex = (m: MonthKey) => {
	const { year, month } = parseMonthKey(m);
	return year * 12 + (month - 1);
};

/** Meses de calendário de `a` até `b` (negativo se `b` é antes). */
export const monthsBetween = (a: MonthKey, b: MonthKey): number => monthIndex(b) - monthIndex(a);

const ceilDiv = (n: Cents, d: number): Cents => Math.floor((n + d - 1) / d);

export function goalProgress(input: { targetCents: Cents; savedCents: Cents }): {
	remainingCents: Cents;
	percent: number;
	reached: boolean;
} {
	assertCents(input.targetCents, "targetCents");
	assertCents(input.savedCents, "savedCents");
	if (input.targetCents <= 0) throw new RangeError("a meta precisa de um valor maior que zero");
	if (input.savedCents < 0) throw new RangeError("o guardado não pode ser negativo");
	const reached = input.savedCents >= input.targetCents;
	const percent = reached ? 100 : Math.floor((input.savedCents * 100) / input.targetCents);
	return { remainingCents: Math.max(0, input.targetCents - input.savedCents), percent, reached };
}

/** Quanto guardar por mês até o prazo. `today` é a data de hoje (injetada, o engine não lê o relógio). */
export function monthlyNeeded(input: { remainingCents: Cents; deadline: LocalDate; today: LocalDate }): {
	monthsLeft: number;
	monthlyCents: Cents;
} {
	assertCents(input.remainingCents, "remainingCents");
	parseLocalDate(input.deadline);
	parseLocalDate(input.today);
	if (input.remainingCents < 0) throw new RangeError("o que falta não pode ser negativo");
	if (input.deadline < input.today) {
		// Prazo vencido: o que falta é para já.
		return { monthsLeft: 0, monthlyCents: input.remainingCents };
	}
	const monthsLeft = Math.max(1, monthsBetween(monthOf(input.today), monthOf(input.deadline)));
	return { monthsLeft, monthlyCents: ceilDiv(input.remainingCents, monthsLeft) };
}

/** Média mensal dos últimos `GOAL_PACE_MONTHS` meses (o corrente incluído), sem contar meses antes de a meta existir. */
export function goalPace(input: {
	createdOn: LocalDate;
	contributions: readonly GoalContribution[];
	today: LocalDate;
}): Cents {
	parseLocalDate(input.createdOn);
	const thisMonth = monthOf(input.today);
	const [first = thisMonth] = [
		monthOf(input.createdOn),
		...input.contributions.map((c) => monthOf(c.date)),
	].sort();
	const windowMonths = Math.min(GOAL_PACE_MONTHS, Math.max(1, monthsBetween(first, thisMonth) + 1));
	const from = addMonths(thisMonth, -(windowMonths - 1));
	const inWindow = input.contributions
		.filter((c) => monthOf(c.date) >= from && c.date <= input.today)
		.map((c) => c.amountCents);
	return Math.floor(sumCents(inWindow) / windowMonths);
}

/** Tudo que a tela mostra de uma meta. Só inteiros; sem relógio, sem banco. */
export function summarizeGoal(input: GoalInput, today: LocalDate): GoalSummary {
	parseLocalDate(today);
	for (const c of input.contributions) {
		assertCents(c.amountCents, "contribuição");
		if (c.amountCents <= 0) throw new RangeError("a contribuição precisa ser maior que zero");
		parseLocalDate(c.date);
	}
	const savedCents = sumCents(input.contributions.map((c) => c.amountCents));
	const { remainingCents, percent, reached } = goalProgress({ targetCents: input.targetCents, savedCents });
	const paceCents = goalPace({ createdOn: input.createdOn, contributions: input.contributions, today });

	const needed =
		input.deadline === null || reached
			? null
			: monthlyNeeded({ remainingCents, deadline: input.deadline, today });
	const monthlyNeededCents = reached ? 0 : (needed?.monthlyCents ?? null);

	let projectedDate: LocalDate | null = null;
	if (reached) {
		projectedDate = today;
	} else if (paceCents > 0) {
		const months = ceilDiv(remainingCents, paceCents);
		if (months <= GOAL_MAX_PROJECTION_MONTHS) {
			projectedDate = clampDayInMonth(addMonths(monthOf(today), months), parseLocalDate(today).day);
		}
	}

	let status: GoalStatus;
	if (reached) status = "reached";
	else if (input.deadline === null) status = "no_deadline";
	else if (input.deadline < today) status = "behind";
	else if (savedCents === 0 && monthOf(input.createdOn) >= monthOf(today)) {
		// Meta nova, ainda sem nada guardado no mês em que nasceu: não há ritmo para cobrar.
		status = "on_track";
	} else status = paceCents >= (needed?.monthlyCents ?? 0) ? "on_track" : "behind";

	return {
		savedCents,
		remainingCents,
		percent,
		reached,
		monthsLeft: needed?.monthsLeft ?? null,
		monthlyNeededCents,
		paceCents,
		projectedDate,
		status,
	};
}

/** Soma do guardado e do alvo de várias metas (cabeçalho da lista). */
export function goalsTotals(goals: readonly { savedCents: Cents; targetCents: Cents }[]): {
	savedCents: Cents;
	targetCents: Cents;
} {
	return {
		savedCents: sumCents(goals.map((g) => g.savedCents)),
		targetCents: sumCents(goals.map((g) => g.targetCents)),
	};
}
