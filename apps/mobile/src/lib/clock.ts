import type { LocalDate, MonthKey } from "@orbita/core";
import { DEFAULT_TIME_ZONE, monthOf, toLocalDate } from "@orbita/core";

export interface ClockState {
	today: LocalDate;
	month: MonthKey;
	/** Hora (0..23) no fuso do usuário; muda a saudação. */
	hour: number;
}

export function hourOf(now: Date): number {
	const part = new Intl.DateTimeFormat("en-GB", {
		hour: "2-digit",
		hourCycle: "h23",
		timeZone: DEFAULT_TIME_ZONE,
	})
		.formatToParts(now)
		.find((p) => p.type === "hour")?.value;
	return Number(part ?? 0);
}

export function clockAt(now: Date): ClockState {
	const today = toLocalDate(now);
	return { today, month: monthOf(today), hour: hourOf(now) };
}

/** Mesmo objeto se nada mudou (não re-renderiza); novo se o dia, o mês ou a hora mudaram. */
export function nextClock(prev: ClockState, now: Date): ClockState {
	const next = clockAt(now);
	return next.today === prev.today && next.hour === prev.hour ? prev : next;
}
