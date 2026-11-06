import type { LocalDate } from "@orbita/core";
import { isLocalDate } from "@orbita/shared";

/**
 * `@db.Date` guarda só o dia; o Prisma o entrega como `Date` à meia-noite UTC. Converter
 * sempre por UTC evita o dia andar com o fuso do servidor ("2026-02-28" virar 27).
 */
export function toDbDate(date: LocalDate): Date {
	if (!isLocalDate(date)) throw new RangeError(`data inválida: ${date}`);
	return new Date(`${date}T00:00:00.000Z`);
}

export function fromDbDate(value: Date): LocalDate {
	return value.toISOString().slice(0, 10);
}
