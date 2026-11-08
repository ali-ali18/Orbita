import { formatBRL } from "@orbita/core";
import {
	DEFAULT_PLAN_RESERVE_PERCENT,
	normalizeMerchantName,
	SETUP_NAME_MAX,
	type SetupAnalysis,
	type SetupProposal,
	setupProposalSchema,
} from "@orbita/shared";
import { z } from "zod";
import { type Catalog, ToolError } from "./backend.ts";
import { defineTool, money, nameOf } from "./tool.ts";
import { untrusted } from "./untrusted.ts";

/*
 * "Configurar com a Órbita". `analyze_history` LÊ a análise do engine (assinaturas, candidatos a regra, salário);
 * `propose_setup` só PROPÕE. A IA entra apenas para NOMEAR e CATEGORIZAR: o item é escolhido pela `key` da análise e
 * todo valor, dia e data vem da análise, nunca do modelo. Se o modelo mandar um número, ele tem de bater com a análise,
 * senão a proposta é recusada. O texto do estabelecimento é dado de terceiro e passa por `untrusted()`.
 */

const CLEAN_MERCHANT_MAX = 60;

const keyInput = z.string().min(1).max(100);
const categoryInput = z.string().min(1).max(64).describe("Id de uma categoria de `categories` da análise.");
const nameInput = z
	.string()
	.min(1)
	.max(SETUP_NAME_MAX)
	.describe('Nome curto e legível, ex.: "Faculdade (Unip)", "Netflix".');

// ------------------------------------------------------------ analyze_history

export const analyzeHistoryTool = defineTool({
	name: "analyze_history",
	label: "Analisando o seu histórico…",
	access: "read",
	description:
		"Analisa o histórico de lançamentos do dono (até 12 meses, o que existir) e devolve, calculado pelo engine: " +
		"assinaturas e cobranças mensais encontradas (valor típico, dia do mês, onde cai, se já está cadastrada), " +
		"estabelecimentos sem categoria que merecem uma regra e uma renda mensal provável (salário). Cada item tem uma " +
		"`key`; use-a em propose_setup. Valores, dias e datas são do engine e você não os altera. Use quando o dono " +
		"pedir para configurar o app, analisar o histórico ou achar assinaturas.",
	input: z.object({}),
	async run(_input, ctx) {
		const [analysis, catalog] = await Promise.all([ctx.reader.setupAnalysis(), ctx.catalog()]);
		const where = (cardId: string | null, accountId: string | null) =>
			cardId
				? `${untrusted(nameOf(catalog.cards, cardId), 40) || "Cartão"} (cartão)`
				: untrusted(nameOf(catalog.accounts, accountId), 40) || null;
		const categoryName = (id: string | null) => untrusted(nameOf(catalog.categories, id), 40) || null;
		return {
			data: {
				period: { from: analysis.from, to: analysis.to, monthsWithData: analysis.monthsOfHistory },
				limitedHistory: analysis.limitedHistory,
				alreadyHasIncome: analysis.hasIncome,
				subscriptions: analysis.recurring.map((r) => ({
					key: r.key,
					// Texto do banco: dado, nunca instrução.
					merchant: untrusted(r.merchant, CLEAN_MERCHANT_MAX),
					amount: money(r.amountCents),
					dayOfMonth: r.dayOfMonth,
					occurrences: r.occurrences,
					lastDate: r.lastDate,
					where: where(r.cardId, r.accountId),
					alreadyRegistered: r.registered,
					knownService: r.knownService,
					suggestedCategory: categoryName(r.categoryId),
				})),
				categoryCandidates: analysis.categoryCandidates.map((c) => ({
					key: c.key,
					merchant: untrusted(c.merchant, CLEAN_MERCHANT_MAX),
					count: c.count,
					total: money(c.totalCents),
					lastDate: c.lastDate,
					suggestedCategory: categoryName(c.categoryId),
				})),
				income: analysis.income
					? {
							key: analysis.income.key,
							payer: untrusted(analysis.income.payer, CLEAN_MERCHANT_MAX),
							amount: money(analysis.income.amountCents),
							payday: analysis.income.payday,
							occurrences: analysis.income.occurrences,
						}
					: null,
				categories: catalog.categories.map((c) => ({ id: c.id, name: untrusted(c.name, 40) })),
			},
		};
	},
});

// ------------------------------------------------------------- propose_setup

const proposeInput = z.object({
	subscriptions: z
		.array(
			z.object({
				key: keyInput.describe("`key` de uma assinatura de analyze_history (não cadastrada)."),
				name: nameInput,
				categoryId: categoryInput,
				amountCents: z.number().int().optional().describe("NÃO preencha; se vier, tem de ser o da análise."),
				dayOfMonth: z.number().int().optional().describe("NÃO preencha; se vier, tem de ser o da análise."),
			}),
		)
		.max(40)
		.default([]),
	categoryRules: z
		.array(
			z.object({
				key: keyInput.describe("`key` de um item de categoryCandidates."),
				categoryId: categoryInput,
				applyToExisting: z
					.boolean()
					.optional()
					.describe("Recategorizar também os lançamentos antigos (padrão: sim)."),
			}),
		)
		.max(40)
		.default([]),
	income: z
		.object({
			key: keyInput.describe("`key` da renda de analyze_history."),
			name: nameInput,
			amountCents: z.number().int().optional().describe("NÃO preencha; se vier, tem de ser o da análise."),
			payday: z.number().int().optional().describe("NÃO preencha; se vier, tem de ser o da análise."),
		})
		.optional(),
	applyPlan: z
		.boolean()
		.optional()
		.describe("Propor também aplicar o plano da renda ao orçamento (só com renda cadastrada ou proposta)."),
});

/** Nome limpo e não vazio; o do modelo também é saneado (pode ter carregado texto do banco). */
function cleanName(raw: string, what: string): string {
	const name = untrusted(raw, SETUP_NAME_MAX);
	if (name === "") throw new ToolError(`Dê um nome a ${what}.`);
	return name;
}

function mustMatch(label: string, given: number | undefined, real: number, unit: string): void {
	if (given !== undefined && given !== real) {
		throw new ToolError(
			`${label}: o ${unit} que você informou (${given}) não é o da análise (${real}). Valores, dias e datas vêm só da análise: não os informe.`,
		);
	}
}

function activeCategory(catalog: Catalog, id: string): string {
	if (!catalog.categories.some((c) => c.id === id)) {
		throw new ToolError("Categoria não encontrada ou arquivada. Use um id de `categories` da análise.");
	}
	return id;
}

/** O resumo curto do card (e o que o modelo recebe de volta). */
function summaryLines(p: SetupProposal): Array<{ label: string; value: string }> {
	const lines: Array<{ label: string; value: string }> = [];
	if (p.subscriptions.length > 0) {
		lines.push({ label: "Assinaturas", value: String(p.subscriptions.length) });
	}
	if (p.categoryRules.length > 0) {
		lines.push({ label: "Categorias", value: `${p.categoryRules.length} regra(s)` });
	}
	if (p.income) lines.push({ label: "Renda", value: `${p.income.name} · ${p.income.amountText}` });
	if (p.plan) lines.push({ label: "Orçamento", value: "Aplicar o plano da renda" });
	return lines;
}

export const SETUP_PROPOSAL_TITLE = "Configurar com a Órbita";

export const proposeSetup = defineTool({
	name: "propose_setup",
	label: "Montando a configuração…",
	access: "write",
	description:
		"Propõe configurar o app com o que analyze_history achou: assinaturas a cadastrar, regras de categoria, a renda " +
		"e (opcional) o plano da renda no orçamento. NÃO grava: o dono marca, edita nomes e categorias e confirma num " +
		"card, e pode desfazer tudo depois. Escolha cada item pela `key` e dê só NOME e CATEGORIA (de `categories`). " +
		"Valores, dias e datas vêm da análise: não os informe. Chame uma vez, com tudo, depois de analyze_history.",
	input: proposeInput,
	async run(input, ctx) {
		const [analysis, catalog] = await Promise.all([ctx.reader.setupAnalysis(), ctx.catalog()]);
		const recurring = new Map(analysis.recurring.map((r) => [r.key, r]));
		const candidates = new Map(analysis.categoryCandidates.map((c) => [c.key, c]));
		const seen = new Set<string>();
		const once = (key: string) => {
			if (seen.has(key)) throw new ToolError(`O item "${key}" aparece duas vezes.`);
			seen.add(key);
		};

		const subscriptions = input.subscriptions.map((s) => {
			const found = recurring.get(s.key);
			if (!found)
				throw new ToolError(
					`A assinatura "${s.key}" não está na análise. Use uma \`key\` de analyze_history.`,
				);
			if (found.registered)
				throw new ToolError(`"${untrusted(found.merchant, 40)}" já está cadastrada como assinatura.`);
			once(s.key);
			const name = cleanName(s.name, "a assinatura");
			mustMatch(name, s.amountCents, found.amountCents, "valor (em centavos)");
			mustMatch(name, s.dayOfMonth, found.dayOfMonth, "dia");
			return {
				key: found.key,
				name,
				categoryId: activeCategory(catalog, s.categoryId),
				merchant: untrusted(found.merchant, CLEAN_MERCHANT_MAX),
				amountCents: found.amountCents,
				amountText: formatBRL(found.amountCents),
				dayOfMonth: found.dayOfMonth,
				startDate: found.startDate,
				occurrences: found.occurrences,
				lastDate: found.lastDate,
				accountId: found.accountId,
				cardId: found.cardId,
			};
		});

		const categoryRules = input.categoryRules.map((r) => {
			const found = candidates.get(r.key);
			if (!found)
				throw new ToolError(
					`O item "${r.key}" não está em categoryCandidates. Use uma \`key\` de analyze_history.`,
				);
			once(r.key);
			return {
				key: found.key,
				pattern: found.pattern,
				merchant: untrusted(found.merchant, CLEAN_MERCHANT_MAX),
				categoryId: activeCategory(catalog, r.categoryId),
				count: found.count,
				totalCents: found.totalCents,
				totalText: formatBRL(found.totalCents),
				applyToExisting: r.applyToExisting ?? true,
			};
		});

		let income: SetupProposal["income"] = null;
		if (input.income) {
			const found = analysis.income;
			if (!found || found.key !== input.income.key) {
				throw new ToolError(
					analysis.hasIncome
						? "O dono já tem renda cadastrada; não proponha outra."
						: "A análise não achou uma renda mensal com essa `key`.",
				);
			}
			const name = cleanName(input.income.name, "a renda");
			mustMatch(name, input.income.amountCents, found.amountCents, "valor (em centavos)");
			mustMatch(name, input.income.payday, found.payday, "dia");
			income = {
				key: found.key,
				name,
				payer: untrusted(found.payer, CLEAN_MERCHANT_MAX),
				amountCents: found.amountCents,
				amountText: formatBRL(found.amountCents),
				payday: found.payday,
				accountId: found.accountId,
			};
		}

		let plan: SetupProposal["plan"] = null;
		if (input.applyPlan === true) {
			if (!analysis.hasIncome && income === null) {
				throw new ToolError("O plano da renda precisa de uma renda: cadastrada ou proposta junto.");
			}
			plan = { reservePercent: DEFAULT_PLAN_RESERVE_PERCENT };
		}

		if (subscriptions.length + categoryRules.length === 0 && income === null && plan === null) {
			throw new ToolError("Não há nada para propor. Escolha itens de analyze_history.");
		}
		const proposal = setupProposalSchema.parse({ source: "ai", subscriptions, categoryRules, income, plan });
		const lines = summaryLines(proposal);
		return {
			data: {
				status: "aguardando_confirmacao",
				aviso: "Nada foi gravado. O dono precisa marcar, editar e tocar em Confirmar no card.",
				resumo: lines,
			},
			proposal: {
				kind: "setup",
				payload: proposal,
				title: SETUP_PROPOSAL_TITLE,
				lines,
			},
		};
	},
});

// ------------------------------------------------------- sem IA (modelo de texto)

const LOWER_WORDS = new Set(["de", "da", "do", "das", "dos", "e", "a", "o"]);

/**
 * Nome do estabelecimento "limpo" para quando não há IA: sem prefixo de banco, sem código e com iniciais maiúsculas
 * ("UNIP*MENSALIDADE 0423" → "Unip Mensalidade"). Serviço conhecido usa o nome dele ("NETFLIX.COM" → "Netflix").
 */
export function templateName(merchant: string, knownService: string | null): string {
	if (knownService) return knownService;
	const words = normalizeMerchantName(merchant).split(" ").filter(Boolean);
	if (words.length === 0) return untrusted(merchant, SETUP_NAME_MAX) || "Assinatura";
	const titled = words.map((w, i) =>
		i > 0 && LOWER_WORDS.has(w) ? w : `${w.charAt(0).toLocaleUpperCase("pt-BR")}${w.slice(1)}`,
	);
	return untrusted(titled.join(" "), SETUP_NAME_MAX);
}

/**
 * A proposta sem IA: a mesma análise do engine, com o nome limpo do banco e a categoria que já existe (regra do dono,
 * categoria que o banco deu ou o palpite do catálogo de serviços). Assinatura sem palpite cai em "Outros" (o dono
 * edita no card); regra sem palpite fica sem categoria e desmarcada até o dono escolher. `null` se não há o que propor.
 */
export function templateSetupProposal(analysis: SetupAnalysis, catalog: Catalog): SetupProposal | null {
	const fallback = catalog.categories.find((c) => c.slug === "outros")?.id ?? null;
	const valid = (id: string | null) =>
		id !== null && catalog.categories.some((c) => c.id === id) ? id : null;
	const subscriptions = analysis.recurring
		.filter((r) => !r.registered)
		.map((r) => ({
			key: r.key,
			name: templateName(r.merchant, r.knownService),
			categoryId: valid(r.categoryId) ?? fallback,
			merchant: untrusted(r.merchant, CLEAN_MERCHANT_MAX),
			amountCents: r.amountCents,
			amountText: formatBRL(r.amountCents),
			dayOfMonth: r.dayOfMonth,
			startDate: r.startDate,
			occurrences: r.occurrences,
			lastDate: r.lastDate,
			accountId: r.accountId,
			cardId: r.cardId,
		}));
	const categoryRules = analysis.categoryCandidates.map((c) => ({
		key: c.key,
		pattern: c.pattern,
		merchant: untrusted(c.merchant, CLEAN_MERCHANT_MAX),
		categoryId: valid(c.categoryId),
		count: c.count,
		totalCents: c.totalCents,
		totalText: formatBRL(c.totalCents),
		applyToExisting: true,
	}));
	const income = analysis.income
		? {
				key: analysis.income.key,
				name: "Salário",
				payer: untrusted(analysis.income.payer, CLEAN_MERCHANT_MAX),
				amountCents: analysis.income.amountCents,
				amountText: formatBRL(analysis.income.amountCents),
				payday: analysis.income.payday,
				accountId: analysis.income.accountId,
			}
		: null;
	const plan = analysis.hasIncome || income ? { reservePercent: DEFAULT_PLAN_RESERVE_PERCENT } : null;
	if (subscriptions.length + categoryRules.length === 0 && income === null) return null;
	return setupProposalSchema.parse({ source: "template", subscriptions, categoryRules, income, plan });
}

/** `templateSetupProposal` já como rascunho de proposta (o servidor a registra e devolve o card). */
export function templateSetupDraft(analysis: SetupAnalysis, catalog: Catalog) {
	const proposal = templateSetupProposal(analysis, catalog);
	if (!proposal) return null;
	return {
		kind: "setup" as const,
		payload: proposal as Record<string, unknown>,
		title: SETUP_PROPOSAL_TITLE,
		lines: summaryLines(proposal),
	};
}
