import { cleanExternalLabel, normalizeMerchantName, pickCategoryRule } from "@orbita/shared";

/*
 * Sugestão de categoria em "Novo lançamento": só as regras que o dono já ensinou (as mesmas que o sync aplica),
 * nunca IA. A regra mais específica que casa com o que ele digitou vence; categoria arquivada não é sugerida.
 */

export interface SuggestionRule {
	pattern: string;
	categoryId: string;
}

export interface SuggestionCategory {
	id: string;
	name: string;
	archivedAt: string | null;
}

export interface CategorySuggestion {
	categoryId: string;
	categoryName: string;
	/** Como o dono escreveu a descrição ("iFood"), para a frase "iFood costuma ser delivery". */
	label: string;
}

const LABEL_MAX = 40;

/** `null` se não há regra que case, a categoria sumiu ou está arquivada, ou o tipo não é saída. */
export function suggestCategory(input: {
	kind: "expense" | "income";
	description: string;
	rules: readonly SuggestionRule[];
	categories: readonly SuggestionCategory[];
}): CategorySuggestion | null {
	if (input.kind !== "expense") return null;
	if (normalizeMerchantName(input.description) === "") return null;
	// Só regras de categorias ativas entram na disputa: uma regra de categoria arquivada não esconde a seguinte.
	const active = new Map(input.categories.filter((c) => c.archivedAt === null).map((c) => [c.id, c]));
	const rule = pickCategoryRule(
		input.rules.filter((r) => active.has(r.categoryId)),
		input.description,
	);
	const category = rule ? active.get(rule.categoryId) : undefined;
	const label = cleanExternalLabel(input.description, LABEL_MAX);
	if (!rule || !category || label === null) return null;
	return { categoryId: category.id, categoryName: category.name, label };
}

/** "Sugeri Delivery porque iFood costuma ser delivery". */
export function suggestionText(s: Pick<CategorySuggestion, "categoryName" | "label">): string {
	return `Sugeri ${s.categoryName} porque ${s.label} costuma ser ${s.categoryName.toLocaleLowerCase("pt-BR")}`;
}

/**
 * Estado da sugestão: aparece enquanto o dono não escolheu categoria e não a dispensou. Aparecendo, ela já vale
 * (vem marcada); "Aceitar" a torna escolha dele e "Trocar" a dispensa.
 */
export function suggestionState(input: {
	suggestion: CategorySuggestion | null;
	chosenId: string | null;
	dismissedId: string | null;
}): { shown: CategorySuggestion | null; effectiveId: string | null } {
	const { suggestion, chosenId, dismissedId } = input;
	const shown =
		suggestion !== null && chosenId === null && dismissedId !== suggestion.categoryId ? suggestion : null;
	return { shown, effectiveId: chosenId ?? shown?.categoryId ?? null };
}
