import type { PluggyCategory } from "./schemas.ts";

/*
 * Classificação de lançamento do Pluggy pela categoria dele. Tudo aqui é função pura.
 *
 * O Pluggy manda a categoria como texto (`category`, em inglês ou português) e um `categoryId`; a árvore (`GET
 * /categories`) liga cada categoria ao pai (`parentId`/`parentDescription`). Os NOMES abaixo são suposição (o SDK não
 * traz a lista; ver docs/pluggy.md): por isso a decisão olha a folha E os ancestrais, por trechos do nome, e nunca
 * por id fixo. Quem erra vira "Outros" (gasto) ou segue o fluxo antigo, nunca some com dinheiro em silêncio.
 */

/** Minúsculo e sem acento, para comparar texto. */
export const plain = (value: string | null | undefined) =>
	(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** A árvore de categorias do Pluggy, por id. */
export type CategoryIndex = ReadonlyMap<string, PluggyCategory>;

export function buildCategoryIndex(categories: readonly PluggyCategory[]): CategoryIndex {
	return new Map(categories.map((c) => [c.id, c]));
}

const MAX_DEPTH = 6;

/**
 * Nomes (sem acento, minúsculos) da categoria do lançamento e de seus ancestrais, da folha para a raiz. Sem a árvore
 * (ou sem `categoryId`), só o texto que veio no lançamento e, se houver, o `parentDescription` que a árvore dá.
 */
export function categoryChain(
	tx: { category?: string | null | undefined; categoryId?: string | null | undefined },
	index?: CategoryIndex,
): string[] {
	const chain: string[] = [];
	const push = (value: string | null | undefined) => {
		const text = plain(value);
		if (text !== "" && !chain.includes(text)) chain.push(text);
	};
	push(tx.category);
	let node = tx.categoryId ? index?.get(tx.categoryId) : undefined;
	const seen = new Set<string>();
	for (let depth = 0; node && depth < MAX_DEPTH && !seen.has(node.id); depth++) {
		seen.add(node.id);
		push(node.description);
		const parent: PluggyCategory | undefined = node.parentId ? index?.get(node.parentId) : undefined;
		if (!parent) push(node.parentDescription);
		node = parent;
	}
	return chain;
}

const anyMatch = (chain: readonly string[], pattern: RegExp) => chain.some((c) => pattern.test(c));

// ---------------------------------------------------------------- famílias que não são consumo

const CARD_PAYMENT = /\b(credit card payment|pagamento de (cartao|fatura)|pagamento fatura)/;
const OWN_TRANSFER = /\b(same ownership|same person|mesma titularidade|mesmo titular)/;
/** Raiz ou folha de investimento (aplicar, resgatar, guardar). "Retirement" sozinho é aposentadoria, receita. */
const INVESTMENT =
	/\b(investment|investimento|fixed income|renda fixa|variable income|renda variavel|mutual fund|fundos? de investimento|automatic application|aplicacao|previdencia|savings account|poupanca|caixinha|cdb|rdb|tesouro)/;
/** Dinheiro que o investimento rendeu (a receita de verdade; o principal não é). */
const YIELD =
	/\b(rendimento|dividend|provento|interests? on investments?|investment income|juros sobre capital)/;
/** Categoria genérica: o Pluggy não soube dizer, então vale o plano B pela descrição. */
const GENERIC = /^(other|others|outros|outras|uncategorized|sem categoria|not categorized|nao categorizado)$/;

/** Plano B, só com categoria ausente ou genérica: palavras que, inteiras, indicam mexer no próprio investimento. */
const INVESTMENT_DESCRIPTION =
	/\b(aplicacao|aplic|resgate|resg|caixinha|cdb|rdb|lci|lca|poupanca|tesouro direto|dinheiro guardado)\b/;
const YIELD_DESCRIPTION = /\b(rendimentos?|rend pago|rend\.? aplic)/;

export type PluggyFamily =
	| "card_payment" // pagamento de fatura
	| "own_transfer" // transferência para a mesma titularidade
	| "investment" // aplicação, resgate, caixinha, poupança: o dinheiro só mudou de bolso
	| "yield" // rendimento de investimento: receita
	| "other"; // consumo comum (ou receita comum)

/**
 * Família do lançamento pela categoria (e, só no plano B, pela descrição). `direction` é o sentido na conta: rendimento
 * só existe como entrada; saída em categoria de investimento é aplicação.
 */
export function classifyFamily(input: {
	chain: readonly string[];
	description: string;
	direction: "in" | "out";
	/** Plano B por descrição só vale em conta corrente. */
	allowDescriptionFallback: boolean;
}): PluggyFamily {
	const { chain, direction } = input;
	if (anyMatch(chain, CARD_PAYMENT)) return "card_payment";
	if (anyMatch(chain, OWN_TRANSFER)) return "own_transfer";
	if (direction === "in" && anyMatch(chain, YIELD)) return "yield";
	if (anyMatch(chain, INVESTMENT)) return "investment";
	const description = plain(input.description);
	const noCategory = chain.length === 0 || chain.every((c) => GENERIC.test(c));
	if (input.allowDescriptionFallback && noCategory) {
		if (direction === "in" && YIELD_DESCRIPTION.test(description)) return "yield";
		if (INVESTMENT_DESCRIPTION.test(description)) return "investment";
	}
	return "other";
}

// ------------------------------------------------- categorias de consumo do Órbita

/** Slugs de `DEFAULT_CATEGORIES` (packages/db) em que um gasto do Pluggy pode cair. */
export type SpendingSlug =
	| "mercado"
	| "delivery"
	| "transporte"
	| "assinaturas"
	| "lazer"
	| "moradia"
	| "saude"
	| "outros";

/**
 * Trechos do nome da categoria (folha ou ancestral) → categoria do Órbita. A ordem importa: a primeira regra que bate
 * em algum nome da cadeia (da folha para a raiz) decide, então "Gas stations" cai em Transporte antes de "gás" de Moradia.
 */
const SPENDING_RULES: ReadonlyArray<readonly [SpendingSlug, RegExp]> = [
	["mercado", /\b(grocer|supermarket|supermercado|mercado|hortifruti|wholesale|atacado)/],
	[
		"delivery",
		/\b(eating out|restaurant|food delivery|delivery|fast food|lanchonete|bakery|padaria|coffee|cafeteria|snack|lanche|alimentacao|refeicao|ifood)/,
	],
	[
		"transporte",
		/\b(transport|taxi|ride|fuel|gasoline|gas station|combustivel|posto|parking|estacionamento|toll|pedagio|vehicle|veiculo|public transit|onibus|bus\b|metro\b|train|trem|auto\b|automotive|car rental)/,
	],
	["assinaturas", /\b(digital service|subscription|assinatura|streaming|software|cloud|app store)/],
	[
		"saude",
		/\b(health|saude|pharmac|farmacia|drugstore|medic|doctor|dental|dentist|hospital|clinic|exame|wellness|therap|optic)/,
	],
	[
		"moradia",
		/\b(housing|moradia|rent\b|aluguel|condominio|utilities|electric|energia|water\b|agua\b|gas\b|internet|telecom|phone|telefone|furniture|mortgage|financiamento imobiliario|home\b)/,
	],
	[
		"lazer",
		/\b(entertainment|leisure|lazer|travel|viagem|hotel|lodging|airline|game|sport|esporte|gym\b|academia|cinema|movie|music|musica|event|hobb)/,
	],
];

/** Categoria de consumo do Órbita para a cadeia de nomes do Pluggy. Sem correspondência: `outros`. */
export function spendingSlugFor(chain: readonly string[]): SpendingSlug {
	for (const name of chain) {
		for (const [slug, pattern] of SPENDING_RULES) if (pattern.test(name)) return slug;
	}
	return "outros";
}
