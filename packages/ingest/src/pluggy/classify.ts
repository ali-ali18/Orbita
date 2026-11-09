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
/**
 * Descrição de pagamento de fatura de CARTÃO (a categoria do banco às vezes diz só "Transferência"). Exige a palavra
 * cartão/crédito: "pagamento de fatura Vivo" é conta de telefone, não cartão.
 */
const CARD_PAYMENT_DESCRIPTION =
	/\b(pagamento|pagto|pag)\.? (da |de |do )?(fatura|cartao|cart)\b.*\b(cartao|credito|card)\b|\b(pagamento|pagto|pag)\.? (de )?cartao( de credito)?\b|\bfatura (do )?cartao\b/;
const OWN_TRANSFER = /\b(same ownership|same person|mesma titularidade|mesmo titular)/;
/** Raiz ou folha de investimento (aplicar, resgatar, guardar). "Retirement" sozinho é aposentadoria, receita. */
const INVESTMENT =
	/\b(investment|investimento|fixed income|renda fixa|variable income|renda variavel|mutual fund|fundos? de investimento|automatic application|aplicacao|previdencia|savings account|poupanca|caixinha|cdb|rdb|tesouro)/;
/** Dinheiro que o investimento rendeu (a receita de verdade; o principal não é). */
const YIELD =
	/\b(rendimento|dividend|provento|interests? on investments?|investment income|juros sobre capital)/;
/** Categoria genérica: o Pluggy não soube dizer, então vale o plano B pela descrição. */
const GENERIC = /^(other|others|outros|outras|uncategorized|sem categoria|not categorized|nao categorizado)$/;
/** Transferência não diz o que foi comprado: a descrição ainda pode dizer. */
const VAGUE = /\b(transfers?|transferencias?|pix|ted|doc|wire)\b/;

/**
 * Categoria que a frase do banco já permite, sem chute. `null` quando o texto não diz
 * (um PIX "Rei Dos" continua sem categoria).
 */
export function suggestSpendingSlug(input: {
	sourceCategory?: string | null;
	description?: string | null;
	merchantName?: string | null;
}): SpendingSlug | null {
	const chain = (input.sourceCategory ?? "")
		.split("›")
		.map((part) => plain(part))
		.filter((part) => part !== "");
	const fromChain = matchSpendingSlug(chain);
	if (fromChain) return fromChain;
	const text = [plain(input.merchantName), plain(input.description)].filter((name) => name !== "");
	const fromText = matchSpendingSlug(text);
	if (fromText) return fromText;
	// Aplicação, resgate e caixinha têm categoria própria. PIX sem compra conhecida também.
	const names = [...chain, ...text];
	if (names.some((name) => INVESTMENT.test(name))) return "investimentos";
	if (names.some((name) => VAGUE.test(name))) return "transferencias";
	return null;
}

/** A cadeia não escolheu um consumo: vazia, genérica ("Outros") ou só transferência. */
export function chainLeavesSpendingOpen(chain: readonly string[]): boolean {
	return chain.length === 0 || chain.every((name) => GENERIC.test(name) || VAGUE.test(name));
}

/** Plano B, só com categoria ausente ou genérica: palavras que, inteiras, indicam mexer no próprio investimento. */
const INVESTMENT_DESCRIPTION =
	/\b(aplicacao|aplic|resgate|resg|caixinha|cdb|rdb|lci|lca|poupanca|tesouro direto|dinheiro guardado)\b/;
const YIELD_DESCRIPTION = /\b(rendimentos?|rend pago|rend\.? aplic)/;

// ------------------------------------------------ tipo da operação (Open Finance)

/**
 * `operationType` do Pluggy, só em conectores Open Finance (docs.pluggy.ai/docs/transactions, propriedade
 * `operationType`; docs.pluggy.ai/reference/transactions-list). Valores documentados:
 * - conta: TED DOC PIX TRANSFERENCIA_MESMA_INSTITUICAO BOLETO CONVENIO_ARRECADACAO PACOTE_TARIFA_SERVICOS
 *   TARIFA_SERVICOS_AVULSOS FOLHA_PAGAMENTO DEPOSITO SAQUE CARTAO ENCARGOS_JUROS_CHEQUE_ESPECIAL
 *   RENDIMENTO_APLIC_FINANCEIRA PORTABILIDADE_SALARIO RESGATE_APLIC_FINANCEIRA OPERACAO_CREDITO OUTROS;
 * - cartão: PAGAMENTO PAGAMENTO_FATURA TARIFA OPERACOES_CREDITO_CONTRATADAS_CARTAO ESTORNO CASHBACK OUTROS.
 * "Pagamento recebido" (a baixa da fatura que o próprio Pluggy monta a partir de `/bills`) também traz PAGAMENTO_FATURA.
 * Não há valor de "aplicação" na lista da conta: aplicar continua por categoria/descrição (`classifyFamily`).
 */
export const normalizeOperationType = (value: string | null | undefined): string | null => {
	const op = (value ?? "").trim().toUpperCase().replace(/\s+/g, "_");
	return op === "" ? null : op;
};

/**
 * O que o `operationType` já decide sozinho, sem olhar categoria nem descrição; `null` = não decide (PIX, TED, BOLETO,
 * OUTROS ou ausente), e aí vale o plano B por categoria/nome. Só a direção coerente decide: um RENDIMENTO que SAIU da
 * conta não é receita (cai no plano B).
 * - `card_payment`: PAGAMENTO_FATURA (pagamento parcial ou total da fatura; no cartão é a baixa, no banco é o débito);
 * - `refund`: ESTORNO e CASHBACK que entram no cartão (crédito que abate a fatura);
 * - `yield`: RENDIMENTO_APLIC_FINANCEIRA que entrou (a receita de verdade);
 * - `redemption`: RESGATE_APLIC_FINANCEIRA que entrou (o principal que volta, nem renda nem gasto).
 */
export type OperationSignal = "card_payment" | "refund" | "yield" | "redemption";

export function operationSignal(
	operationType: string | null | undefined,
	direction: "in" | "out",
): OperationSignal | null {
	const op = normalizeOperationType(operationType);
	if (op === "PAGAMENTO_FATURA") return "card_payment";
	if (direction === "in" && (op === "ESTORNO" || op === "CASHBACK")) return "refund";
	if (direction === "in" && op === "RENDIMENTO_APLIC_FINANCEIRA") return "yield";
	if (direction === "in" && op === "RESGATE_APLIC_FINANCEIRA") return "redemption";
	return null;
}

/** Operações do cartão que o banco já classificou como algo que NÃO é pagamento de fatura (a descrição não manda mais). */
const CARD_KNOWN_NOT_PAYMENT = new Set([
	"PAGAMENTO",
	"TARIFA",
	"OPERACOES_CREDITO_CONTRATADAS_CARTAO",
	"ESTORNO",
	"CASHBACK",
]);

/** Tarifa ou operação de crédito do cartão: crédito com esse tipo nunca é baixa de fatura (fora do pool de casamento). */
export const isCardChargeOperation = (operationType: string | null | undefined): boolean => {
	const op = normalizeOperationType(operationType);
	return op === "TARIFA" || op === "OPERACOES_CREDITO_CONTRATADAS_CARTAO";
};

/** O banco disse, pelo `operationType`, que esta operação do cartão não é pagamento de fatura. */
export const operationExcludesCardPayment = (operationType: string | null | undefined): boolean => {
	const op = normalizeOperationType(operationType);
	return op !== null && CARD_KNOWN_NOT_PAYMENT.has(op);
};

/**
 * Crédito no CARTÃO que é a baixa de uma fatura, mesmo quando o banco o rotula como outra coisa. Nos dados reais o
 * `operationType` e a categoria variam: Inter "PAGAMENTO ON LINE" (op PAGAMENTO, categoria Shopping), Santander
 * "PAGAMENTO DE FATURA" (op PAGAMENTO, categoria Credit card payment), Nubank e Mercado Pago "Pagamento recebido" (op
 * PAGAMENTO_FATURA). `PAGAMENTO` também rotula COMPRAS no cartão, então o `operationType` não decide nada aqui: valem
 * a categoria e a descrição. Só ESTORNO/CASHBACK (o banco disse que é estorno) escapam.
 */
const CARD_SIDE_PAYMENT_TEXT =
	/\b(pagamento (on ?line|online|recebido|de fatura|fatura|efetuado)|pagto (de )?fatura|payment received|credit card payment)\b/;

export function isCardSidePayment(input: {
	chain: readonly string[];
	description: string;
	operationType?: string | null | undefined;
}): boolean {
	const op = normalizeOperationType(input.operationType);
	if (op === "PAGAMENTO_FATURA") return true;
	if (op === "ESTORNO" || op === "CASHBACK") return false;
	const text = plain(input.description);
	if (REFUND_WORDS.test(text) || anyMatch(input.chain, REFUND_WORDS)) return false;
	return anyMatch(input.chain, CARD_PAYMENT) || CARD_SIDE_PAYMENT_TEXT.test(text);
}

const REFUND_WORDS = /\b(estorno|devolucao|refund|chargeback|cashback)\b/;

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
	/** `operationType` do Pluggy: quando decide (`operationSignal`), vale mais que categoria e descrição. */
	operationType?: string | null | undefined;
}): PluggyFamily {
	const { chain, direction } = input;
	const signal = operationSignal(input.operationType, direction);
	if (signal === "card_payment") return "card_payment";
	if (signal === "yield") return "yield";
	if (signal === "redemption") {
		// Mercado Pago manda os "Rendimentos" diários com RESGATE_APLIC_FINANCEIRA (dados reais): quando a categoria ou a
		// descrição diz rendimento, o que entrou é o que rendeu, não o principal que voltou.
		return direction === "in" && (anyMatch(chain, YIELD) || YIELD_DESCRIPTION.test(plain(input.description)))
			? "yield"
			: "investment";
	}
	// O banco disse que a operação do cartão é compra, tarifa, crédito contratado, estorno ou cashback: não é pagamento
	// de fatura, mesmo que a categoria do Pluggy ou o nome digam "pagamento".
	if (!operationExcludesCardPayment(input.operationType) && anyMatch(chain, CARD_PAYMENT))
		return "card_payment";
	if (
		input.allowDescriptionFallback &&
		direction === "out" &&
		CARD_PAYMENT_DESCRIPTION.test(plain(input.description))
	)
		return "card_payment";
	if (anyMatch(chain, OWN_TRANSFER)) return "own_transfer";
	if (direction === "in" && anyMatch(chain, YIELD)) return "yield";
	const description = plain(input.description);
	// Categoria de investimento, mas a descrição diz rendimento ("Rendimentos CDB"): é o que rendeu, não o principal.
	if (anyMatch(chain, INVESTMENT)) {
		return direction === "in" && YIELD_DESCRIPTION.test(description) ? "yield" : "investment";
	}
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
	| "transferencias"
	| "investimentos"
	| "outros";

/**
 * Trechos do nome da categoria (folha ou ancestral) → categoria do Órbita. A ordem importa: a primeira regra que bate
 * em algum nome da cadeia (da folha para a raiz) decide, então "Gas stations" cai em Transporte antes de "gás" de Moradia.
 */
const SPENDING_RULES: ReadonlyArray<readonly [SpendingSlug, RegExp]> = [
	[
		"mercado",
		/\b(grocer|supermarket|supermercado|mercado|hortifruti|wholesale|atacado|carrefour|assai|atacadao|pao de acucar)/,
	],
	[
		"delivery",
		/\b(eating out|restaurant|food and drinks|food delivery|delivery|fast food|lanchonete|bakery|padaria|coffee|cafeteria|snack|lanche|alimentacao|refeicao|ifood|rappi|aiqfome|bars?|bebida)/,
	],
	[
		"transporte",
		/\b(transport|taxi|ride|fuel|gasoline|gas station|combustivel|posto|parking|estacionamento|toll|pedagio|vehicle|veiculo|public transit|onibus|bus\b|metro\b|train|trem|auto\b|automotive|car rental|uber|cabify|99pop)/,
	],
	[
		"assinaturas",
		/\b(digital service|subscription|assinatura|streaming|software|cloud|app store|netflix|spotify|disney|deezer|globoplay|icloud|hbo|prime video|youtube premium)/,
	],
	[
		"saude",
		/\b(health|saude|pharmac|farmacia|drugstore|medic|doctor|dental|dentist|hospital|clinic|exame|wellness|therap|optic|drogasil|droga raia|pague menos)/,
	],
	[
		"moradia",
		/\b(housing|moradia|rent\b|aluguel|condominio|utilities|electric|energia|water\b|agua\b|gas\b|internet|telecom|phone|telefone|furniture|mortgage|financiamento imobiliario|home\b|enel|cemig|sabesp|comgas|cpfl)/,
	],
	[
		"lazer",
		/\b(entertainment|leisure|lazer|travel|viagem|hotel|lodging|airline|game|sport|esporte|gym\b|academia|cinema|movie|music|musica|event|hobb|steam|playstation|ingresso)/,
	],
];

/**
 * Cobrança do Google Play / Google One / YouTube no cartão ("Google One", "DL*GOOGLE YouTub", "DL *GOOGLE Pierre Cont"):
 * o banco manda o intermediário e o app vendido, e o MCC ou a categoria do Pluggy variam de um app para outro
 * (Google One, F1 TV e Pierre caíram em Moradia por telecom/internet). É serviço digital, sempre Assinaturas. Compra de
 * hardware ou de publicidade do Google (Store, Pixel, Nest, Ads) não é.
 */
export function isGoogleDigitalCharge(...texts: Array<string | null | undefined>): boolean {
	return texts.some((t) => {
		const text = plain(t);
		return /^(dl ?\*? ?)?google\b/.test(text) && !/\b(store|pixel|nest|ads|adwords|fiber|fi\b)/.test(text);
	});
}

/** Categoria de consumo pelos nomes da cadeia do Pluggy, ou `null` se nenhum nome bate com a tabela. */
export function matchSpendingSlug(chain: readonly string[]): SpendingSlug | null {
	for (const name of chain) {
		for (const [slug, pattern] of SPENDING_RULES) if (pattern.test(name)) return slug;
	}
	return null;
}

/** Categoria de consumo do Órbita para a cadeia de nomes do Pluggy. Sem correspondência: `outros`. */
export function spendingSlugFor(chain: readonly string[]): SpendingSlug {
	return matchSpendingSlug(chain) ?? "outros";
}

/**
 * Cadeia de categorias do Pluggy para o dono ler, da raiz para a folha ("Pai › Filha"), com a caixa e os acentos
 * originais. `null` se o lançamento não traz categoria. O resultado ainda passa por `cleanSourceCategory` no store.
 */
export function readableCategory(
	tx: { category?: string | null | undefined; categoryId?: string | null | undefined },
	index?: CategoryIndex,
): string | null {
	const leafToRoot: string[] = [];
	const push = (value: string | null | undefined) => {
		const text = (value ?? "").replace(/\s+/g, " ").trim();
		if (text !== "" && !leafToRoot.some((t) => plain(t) === plain(text))) leafToRoot.push(text);
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
	return leafToRoot.length === 0 ? null : leafToRoot.reverse().join(" › ");
}
