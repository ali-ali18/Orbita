import { dayMonth } from "../../lib/format.ts";

/*
 * Lógica pura da tela "Categorias e regras": identificador (slug) de categoria nova, escolha da cor,
 * texto das regras aprendidas e quais consultas recarregar depois de uma mudança.
 */

export const NAME_MAX = 60;
/** Quantas cores a paleta do gráfico tem (`chartSeries`). */
export const COLOR_SLOTS = 10;

export interface CategoryLike {
	id: string;
	slug: string;
	name: string;
	chartSlot: number | null;
	isSystem: boolean;
}

export interface RuleLike {
	id: string;
	pattern: string;
	categoryId: string;
	createdAt: string;
}

/** "Café & Pão" -> "cafe-pao" (minúsculas, sem acento, hífen entre palavras, no máximo 40 letras). */
export function slugify(name: string): string {
	return name
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40)
		.replace(/-+$/g, "");
}

/** Slug livre entre os já usados: "viagem", "viagem-2", "viagem-3"… Nome sem letras vira "categoria". */
export function uniqueSlug(name: string, taken: readonly string[]): string {
	const base = slugify(name) || "categoria";
	const used = new Set(taken);
	if (!used.has(base)) return base;
	for (let n = 2; ; n++) {
		const suffix = `-${n}`;
		const candidate = `${base.slice(0, 40 - suffix.length).replace(/-+$/g, "")}${suffix}`;
		if (!used.has(candidate)) return candidate;
	}
}

export type NameCheck = { ok: true; name: string } | { ok: false; message: string };

export function checkName(raw: string, others: readonly string[]): NameCheck {
	const name = raw.trim().replace(/\s+/g, " ");
	if (name === "") return { ok: false, message: "Informe um nome." };
	if (name.length > NAME_MAX) return { ok: false, message: `O nome passa de ${NAME_MAX} letras.` };
	const key = name.toLocaleLowerCase("pt-BR");
	if (others.some((o) => o.toLocaleLowerCase("pt-BR") === key)) {
		return { ok: false, message: "Já existe uma categoria com esse nome." };
	}
	return { ok: true, name };
}

/** Primeira cor da paleta que nenhuma categoria usa; se todas estão em uso, a menos repetida. */
export function nextFreeSlot(categories: readonly Pick<CategoryLike, "chartSlot">[]): number {
	const counts = new Array<number>(COLOR_SLOTS).fill(0);
	for (const c of categories) {
		if (c.chartSlot !== null && c.chartSlot >= 0 && c.chartSlot < COLOR_SLOTS) {
			counts[c.chartSlot] = (counts[c.chartSlot] ?? 0) + 1;
		}
	}
	let best = 0;
	for (let i = 1; i < COLOR_SLOTS; i++) if ((counts[i] ?? 0) < (counts[best] ?? 0)) best = i;
	return best;
}

export interface RuleRow {
	id: string;
	title: string;
	caption: string;
}

/** Regras da mais nova para a mais antiga: "ifood → Delivery", "Criada em 2 de nov". */
export function ruleRows(rules: readonly RuleLike[], categories: readonly CategoryLike[]): RuleRow[] {
	const names = new Map(categories.map((c) => [c.id, c.name]));
	return [...rules]
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
		.map((r) => ({
			id: r.id,
			title: `${r.pattern} → ${names.get(r.categoryId) ?? "Categoria removida"}`,
			caption: `Criada em ${dayMonth(r.createdAt.slice(0, 10))}`,
		}));
}

/** Mudar categoria ou regra afeta listas, resumo, orçamento e lançamentos já carregados. */
export function isAffectedByCategories(queryKey: readonly unknown[], baseUrl: string): boolean {
	const scope = queryKey[1];
	return (
		queryKey[0] === baseUrl &&
		(scope === "categories" ||
			scope === "category-rules" ||
			scope === "summary" ||
			scope === "budgets" ||
			scope === "transactions")
	);
}
