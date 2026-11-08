import { createHash } from "node:crypto";
import type { StatementItem } from "./types.ts";

type Draft = Omit<StatementItem, "externalId">;

/**
 * Identificador estável para quem não tem id do banco: hash de data + valor + descrição + "ocorrência" (o enésimo
 * item idêntico no arquivo). Usar a ocorrência, e não a posição da linha, mantém o mesmo id quando o banco
 * reexporta um período maior ou menor, então a deduplicação continua funcionando.
 */
export function assignHashIds(drafts: readonly Draft[]): StatementItem[] {
	const seen = new Map<string, number>();
	return drafts.map((draft) => {
		const base = `${draft.date}|${draft.amountCents}|${draft.description.toLowerCase()}`;
		const n = (seen.get(base) ?? 0) + 1;
		seen.set(base, n);
		const hash = createHash("sha256").update(`${base}|${n}`).digest("hex").slice(0, 32);
		return { ...draft, externalId: `h:${hash}` };
	});
}

/**
 * Usa o id do banco quando ele é único no arquivo; quando repete (alguns bancos reaproveitam o FITID), o item
 * cai no hash para não colidir. `repeatedIds` conta os itens que caíram no hash por isso.
 */
export function withBankIds(drafts: ReadonlyArray<Draft & { bankId: string | null }>): {
	items: StatementItem[];
	repeatedIds: number;
} {
	const counts = new Map<string, number>();
	for (const d of drafts) if (d.bankId) counts.set(d.bankId, (counts.get(d.bankId) ?? 0) + 1);
	const hashed = assignHashIds(
		drafts.map((d) => ({ date: d.date, amountCents: d.amountCents, description: d.description })),
	);
	let repeatedIds = 0;
	const items = drafts.map((d, i) => {
		const fallback = hashed[i] as StatementItem;
		const usable = d.bankId !== null && d.bankId.length <= 150 && counts.get(d.bankId) === 1;
		if (d.bankId && !usable) repeatedIds += 1;
		return usable ? { ...fallback, externalId: `b:${d.bankId}` } : fallback;
	});
	return { items, repeatedIds };
}
