import { type Cents, formatBRL, parseBRL } from "@orbita/core";

/** O que o engine já calculou. A resposta só escolhe o número e o texto. */
export interface ChatCategory {
	id: string;
	name: string;
	slug: string;
	spentCents: Cents;
	limitCents: Cents | null;
	remainingCents: Cents | null;
}

export interface ChatSource {
	id: string;
	name: string;
	type: "account" | "card";
}

export interface ChatFacts {
	monthName: string;
	spentCents: Cents;
	incomeCents: Cents;
	categories: readonly ChatCategory[];
	sources: readonly ChatSource[];
	safeToSpend: { availableCents: Cents } | null;
	projectionCents: Cents | null;
}

export interface MonthRow {
	label: string;
	cents: Cents;
	tone: "income" | "spent" | "projection";
}

export type ChatReply =
	| { type: "text"; text: string }
	| { type: "month"; text: string; rows: readonly MonthRow[] }
	| {
			type: "launch";
			amountCents: Cents;
			description: string;
			categoryId: string | null;
			categoryName: string | null;
			source: ChatSource | null;
	  };

const ALIASES: readonly [string, string, string][] = [
	["ifood", "delivery", "iFood"],
	["rappi", "delivery", "Rappi"],
	["uber", "transporte", "Uber"],
	["netflix", "assinaturas", "Netflix"],
	["farmacia", "saude", "Farmácia"],
];

const MONEY = /(?:R\$\s*)?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?/;

function fold(text: string): string {
	return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR");
}

function categoryIn(question: string, categories: readonly ChatCategory[]): ChatCategory | null {
	const text = fold(question);
	const bySlug = new Map(categories.map((c) => [c.slug, c]));
	for (const [word, slug] of ALIASES) {
		if (text.includes(word)) {
			const found = bySlug.get(slug);
			if (found) return found;
		}
	}
	const named = categories
		.filter((c) => c.name.length >= 3 && text.includes(fold(c.name)))
		.sort((a, b) => b.name.length - a.name.length);
	return named[0] ?? null;
}

function sourceIn(question: string, sources: readonly ChatSource[]): ChatSource | null {
	const text = fold(question);
	const named = sources
		.filter((s) => {
			const name = fold(s.name);
			return name.length >= 3 && text.includes(name);
		})
		.sort((a, b) => b.name.length - a.name.length);
	return named[0] ?? null;
}

function amountIn(question: string): Cents | null {
	const match = MONEY.exec(question);
	if (!match) return null;
	try {
		const cents = parseBRL(match[0].replace("R$", "").trim());
		return cents > 0 ? cents : null;
	} catch {
		return null;
	}
}

function prettyDescription(question: string, category: ChatCategory | null): string {
	const text = fold(question);
	for (const [word, , label] of ALIASES) if (text.includes(word)) return label;
	return category?.name ?? "Gasto";
}

function wantsLaunch(question: string): boolean {
	return /\b(gastei|gasto|paguei|lancei|lancar|lançar)\b/i.test(fold(question));
}

/**
 * Resposta do chat. Não soma nem projeta: usa o gasto, o limite, o "dá pra gastar" e a projeção
 * que o resumo do mês já trouxe.
 */
export function answerChat(question: string, facts: ChatFacts): ChatReply {
	const text = fold(question);
	if (text.includes("comprovante")) {
		return { type: "text", text: "Ainda não leio comprovante. Dá para lançar o valor por aqui ou no +." };
	}

	const amount = amountIn(question);
	if (amount !== null && wantsLaunch(question)) {
		const category = categoryIn(question, facts.categories);
		const source = sourceIn(question, facts.sources);
		if (!source) {
			return {
				type: "text",
				text: `O valor é ${formatBRL(amount)}. Diz também a conta ou o cartão, por exemplo no Nubank.`,
			};
		}
		return {
			type: "launch",
			amountCents: amount,
			description: prettyDescription(question, category),
			categoryId: category?.id ?? null,
			categoryName: category?.name ?? null,
			source,
		};
	}

	if (text.includes("fecha")) {
		if (facts.safeToSpend === null || facts.projectionCents === null) {
			return {
				type: "text",
				text: `Neste recorte o gasto é ${formatBRL(facts.spentCents)}. O fechamento só existe no mês atual, com orçamento.`,
			};
		}
		return {
			type: "month",
			text: `Ainda dá pra gastar ${formatBRL(facts.safeToSpend.availableCents)} em ${facts.monthName}. A projeção de gasto é ${formatBRL(facts.projectionCents)}.`,
			rows: [
				{ label: "Entradas", cents: facts.incomeCents, tone: "income" },
				{ label: "Gastos até agora", cents: facts.spentCents, tone: "spent" },
				{ label: "Projeção do mês", cents: facts.projectionCents, tone: "projection" },
			],
		};
	}

	const category = categoryIn(question, facts.categories);
	if (category && /\b(quanto|gastei|gasto)\b/.test(text)) {
		const limit =
			category.limitCents === null
				? "Não há limite nessa categoria."
				: `O limite é ${formatBRL(category.limitCents)} e ainda cabe ${formatBRL(category.remainingCents ?? 0)}.`;
		return {
			type: "text",
			text: `${category.name} está em ${formatBRL(category.spentCents)} este mês. ${limit}`,
		};
	}

	if (text.includes("quanto gastei") || text.includes("gasto do mes")) {
		return { type: "text", text: `O gasto de ${facts.monthName} está em ${formatBRL(facts.spentCents)}.` };
	}

	if (text.includes("da pra gastar") || text.includes("dá pra gastar")) {
		if (facts.safeToSpend === null) {
			return { type: "text", text: "Sem o orçamento do mês atual eu não sei quanto ainda dá pra gastar." };
		}
		return { type: "text", text: `Ainda dá pra gastar ${formatBRL(facts.safeToSpend.availableCents)}.` };
	}

	if (text.includes("lancar um gasto") || text.includes("lançar um gasto")) {
		return {
			type: "text",
			text: "Me diz o valor, onde foi e a conta. Por exemplo: gastei 46,90 no iFood no Nubank.",
		};
	}

	return {
		type: "text",
		text: "Posso dizer o gasto do mês, o de uma categoria e como o mês fecha. Para lançar, manda o valor e a conta.",
	};
}
