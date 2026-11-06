import { DEFAULT_TIME_ZONE, type LocalDate, toLocalDate } from "@orbita/core";

/** Hoje no fuso do usuário (América/São Paulo), como data de calendário. O relógio só entra aqui, na borda. */
export function todayLocal(now: Date = new Date()): LocalDate {
	return toLocalDate(now);
}

/** Hora (0..23) no fuso do usuário, para a saudação. */
export function hourLocal(now: Date = new Date()): number {
	const hour = new Intl.DateTimeFormat("en-GB", {
		hour: "2-digit",
		hourCycle: "h23",
		timeZone: DEFAULT_TIME_ZONE,
	})
		.formatToParts(now)
		.find((p) => p.type === "hour")?.value;
	return Number(hour ?? 0);
}
