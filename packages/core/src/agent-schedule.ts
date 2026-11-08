import {
	addDays,
	addMonths,
	clampDayInMonth,
	DEFAULT_TIME_ZONE,
	monthOf,
	parseLocalDate,
	toLocalDate,
} from "./dates.ts";
import type { LocalDate } from "./types.ts";

/*
 * Agenda dos agentes: "todo dia às 9", "toda segunda às 9", "todo dia 5 às 9". Tudo no fuso do dono e em horas
 * cheias. O worker pergunta `isDue` a cada hora; o engine não conhece relógio, então recebe o instante.
 */

export type AgentFrequencyKind = "daily" | "weekly" | "monthly";

export interface AgentScheduleSpec {
	frequency: AgentFrequencyKind;
	/** 0 a 23. */
	hour: number;
	/** Semanal: 0 (domingo) a 6. Mensal: 1 a 28. Diário: `null`. */
	day: number | null;
}

/** Dia e hora cheia que um instante tem no fuso do dono. */
export function localClock(
	instant: Date,
	timeZone: string = DEFAULT_TIME_ZONE,
): { date: LocalDate; hour: number } {
	const hourPart = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" })
		.formatToParts(instant)
		.find((p) => p.type === "hour")?.value;
	return { date: toLocalDate(instant, timeZone), hour: Number(hourPart) };
}

/** Dia da semana de uma data de calendário (0 = domingo). */
export function weekdayOf(date: LocalDate): number {
	const { year, month, day } = parseLocalDate(date);
	return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export interface Occurrence {
	/** Quando a agenda caiu pela última vez (dia e hora no fuso do dono). */
	date: LocalDate;
	hour: number;
	/** Identifica o período: o dia (diário), o dia da semana marcado (semanal, `w:`) ou o mês (mensal). */
	period: string;
}

const before = (a: { date: LocalDate; hour: number }, b: { date: LocalDate; hour: number }) =>
	a.date < b.date || (a.date === b.date && a.hour < b.hour);

/** A última vez, até `now`, em que a agenda deveria ter rodado. */
export function latestOccurrence(
	schedule: AgentScheduleSpec,
	now: Date,
	timeZone: string = DEFAULT_TIME_ZONE,
): Occurrence {
	const clock = localClock(now, timeZone);
	const at = (date: LocalDate, period: string): Occurrence => ({ date, hour: schedule.hour, period });

	if (schedule.frequency === "daily") {
		const today = at(clock.date, clock.date);
		return before(clock, today) ? at(addDays(clock.date, -1), addDays(clock.date, -1)) : today;
	}

	if (schedule.frequency === "weekly") {
		const target = schedule.day ?? 0;
		const back = (weekdayOf(clock.date) - target + 7) % 7;
		const thisWeek = addDays(clock.date, -back);
		const candidate = at(thisWeek, `w:${thisWeek}`);
		if (!before(clock, candidate)) return candidate;
		const last = addDays(thisWeek, -7);
		return at(last, `w:${last}`);
	}

	const day = schedule.day ?? 1;
	const month = monthOf(clock.date);
	const candidate = at(clampDayInMonth(month, day), month);
	if (!before(clock, candidate)) return candidate;
	const previous = addMonths(month, -1);
	return at(clampDayInMonth(previous, day), previous);
}

/**
 * O agente precisa rodar agora? Sim quando a última vez que a agenda caiu ainda não foi atendida: nunca rodou, ou
 * rodou antes desse horário. Se o worker ficou parado, o próximo ciclo recupera uma execução (não várias).
 */
export function isDue(
	schedule: AgentScheduleSpec,
	lastRunAt: Date | null,
	now: Date,
	timeZone: string = DEFAULT_TIME_ZONE,
): boolean {
	const occurrence = latestOccurrence(schedule, now, timeZone);
	if (lastRunAt === null) return true;
	return before(localClock(lastRunAt, timeZone), occurrence);
}
