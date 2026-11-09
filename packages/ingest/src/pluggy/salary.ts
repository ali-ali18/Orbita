import { addMonths, findSalaryCredits, type LocalDate, monthOf } from "@orbita/core";
import type { Stores } from "@orbita/db";
import { derivePattern } from "@orbita/shared";

/*
 * Rotula como "Salário" a entrada que se repete todo mês do mesmo pagador (ou que bate com a renda cadastrada pelo
 * dono). A decisão é do engine (`findSalaryCredits`); aqui só se lê e se grava. Nunca mexe no que o dono categorizou
 * à mão (`categoryEditedByOwner`) nem em entrada que já tem uma categoria de verdade (regra, escolha): só entrada sem
 * categoria ou em "Outros".
 */

export const SALARY_SLUG = "salario";
/** Quantos meses de entradas a análise olha. */
const LOOKBACK_MONTHS = 6;
const MAX_CREDITS = 500;
/** Palavras do nome do pagador que entram na chave ("Comércio De Ervas LTDA" e "Comercio de Ervas" são o mesmo). */
const PAYER_WORDS = 3;

const payerKey = (merchantName: string | null, description: string): string =>
	(derivePattern(merchantName, description) ?? "").split(" ").slice(0, PAYER_WORDS).join(" ");

/** Devolve quantas entradas foram rotuladas como salário. */
export async function categorizeSalaryCredits(
	stores: Pick<Stores, "transactions" | "categories" | "incomeSources">,
	today: LocalDate,
): Promise<number> {
	const salary = await stores.categories.getBySlug(SALARY_SLUG);
	if (!salary || salary.archivedAt !== null) return 0;
	const outros = (await stores.categories.getBySlug("outros"))?.id ?? null;
	const from = `${addMonths(monthOf(today), -(LOOKBACK_MONTHS - 1))}-01`;
	const rows = await stores.transactions.listRecent({
		limit: MAX_CREDITS,
		filter: { kinds: ["income"], statuses: ["confirmed"], from, to: today },
	});
	if (rows.length === 0) return 0;
	const sources = (await stores.incomeSources.list()).map((s) => ({
		id: s.id,
		amountCents: s.amountCents,
		payday: s.payday,
		recurring: s.recurring,
		month: s.month,
	}));
	const found = findSalaryCredits({
		credits: rows.map((t) => ({
			id: t.id,
			date: t.date,
			amountCents: t.amountCents,
			payer: payerKey(t.merchantName, t.description),
		})),
		incomeSources: sources,
		today,
	});
	let changed = 0;
	for (const t of rows) {
		if (!found.has(t.id)) continue;
		if (t.categoryEditedByOwner) continue;
		if (t.categoryId !== null && t.categoryId !== outros) continue;
		await stores.transactions.update(t.id, { categoryId: salary.id });
		changed += 1;
	}
	return changed;
}
