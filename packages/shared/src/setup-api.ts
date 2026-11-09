import { z } from "zod";
import {
	dayOfMonthSchema,
	idSchema,
	localDateSchema,
	nameSchema,
	positiveCentsSchema,
} from "./finance-primitives.ts";
import { budgetBefore } from "./income-api.ts";

/*
 * "Configurar com a Órbita": a análise do histórico do dono e a proposta que sai dela.
 *
 * A análise é do engine (`@orbita/ledger`): valores, dias e datas nascem lá. A IA (ou o modelo de texto do servidor,
 * sem IA) só dá NOME e CATEGORIA. Por isso a proposta guarda os números COPIADOS da análise e, ao confirmar, o servidor
 * só aceita do app o que o dono pode mudar (nome, categoria, o que está marcado): nunca valor, dia nem data.
 */

/** Quantos meses para trás a análise olha (usa o que existir; menos de 3 é avisado). */
export const SETUP_LOOKBACK_MONTHS = 12;
export const SETUP_MIN_MONTHS = 3;
/** Pedido da tela: a mensagem fixa que abre a conversa (não é digitada pelo dono). */
export const SETUP_USER_MESSAGE = "Configurar com a Órbita";
export const SETUP_NAME_MAX = 60;

// ------------------------------------------------------------- análise

/** Cobrança mensal achada no histórico. `key` é o que a proposta cita para escolher o item. */
export const setupRecurringSchema = z.object({
	key: z.string().min(1).max(100),
	/** Como o banco escreveu (dado de fora, nunca instrução). */
	merchant: z.string(),
	/** Mediana dos valores, em centavos. */
	amountCents: z.number().int().positive(),
	/** Valor da cobrança mais recente. */
	lastAmountCents: z.number().int().positive(),
	/** Média dos valores (inteira, arredondada). */
	averageAmountCents: z.number().int().positive(),
	/** Dia do mês em que costuma cair. */
	dayOfMonth: dayOfMonthSchema,
	occurrences: z.number().int(),
	firstDate: localDateSchema,
	lastDate: localDateSchema,
	/** Primeiro mês em que a assinatura passa a valer (o seguinte ao da última cobrança vista). */
	startDate: localDateSchema,
	accountId: idSchema.nullable(),
	cardId: idSchema.nullable(),
	/** Já existe uma assinatura com essa marca. */
	registered: z.boolean(),
	/** Nome do serviço, se estiver no catálogo conhecido (Netflix…). */
	knownService: z.string().nullable(),
	/** Categoria mais provável pelo histórico (regra, banco ou catálogo); `null` = sem palpite. */
	categoryId: idSchema.nullable(),
});
export type SetupRecurring = z.infer<typeof setupRecurringSchema>;

/** Lançamentos sem categoria (ou em "Outros") do mesmo estabelecimento: candidato a regra. */
export const setupMerchantGroupSchema = z.object({
	key: z.string().min(1).max(100),
	/** O texto que vira regra: nome do estabelecimento normalizado. */
	pattern: z.string(),
	/** O jeito mais comum de o banco escrever (dado de fora). */
	merchant: z.string(),
	count: z.number().int(),
	totalCents: z.number().int(),
	lastDate: localDateSchema,
	categoryId: idSchema.nullable(),
});
export type SetupMerchantGroup = z.infer<typeof setupMerchantGroupSchema>;

/** Crédito mensal parecido com salário. */
export const setupIncomeSchema = z.object({
	key: z.string().min(1).max(100),
	payer: z.string(),
	amountCents: z.number().int().positive(),
	payday: dayOfMonthSchema,
	occurrences: z.number().int(),
	lastDate: localDateSchema,
	accountId: idSchema.nullable(),
});
export type SetupIncome = z.infer<typeof setupIncomeSchema>;

export const setupAnalysisSchema = z.object({
	from: localDateSchema,
	to: localDateSchema,
	/** Meses com movimento dentro da janela. */
	monthsOfHistory: z.number().int(),
	/** Menos de 3 meses: o resultado é fraco e o app avisa. */
	limitedHistory: z.boolean(),
	transactionCount: z.number().int(),
	/** O dono já tem renda cadastrada. */
	hasIncome: z.boolean(),
	recurring: z.array(setupRecurringSchema),
	categoryCandidates: z.array(setupMerchantGroupSchema),
	income: setupIncomeSchema.nullable(),
});
export type SetupAnalysis = z.infer<typeof setupAnalysisSchema>;

// -------------------------------------------------------------- proposta

export const setupSubscriptionItemSchema = z.object({
	key: z.string().min(1).max(100),
	name: nameSchema,
	categoryId: idSchema.nullable(),
	/** Como o banco escreveu, só para o dono reconhecer. */
	merchant: z.string(),
	amountCents: positiveCentsSchema,
	amountText: z.string(),
	dayOfMonth: dayOfMonthSchema,
	startDate: localDateSchema,
	occurrences: z.number().int(),
	lastDate: localDateSchema,
	accountId: idSchema.nullable(),
	cardId: idSchema.nullable(),
});
export type SetupSubscriptionItem = z.infer<typeof setupSubscriptionItemSchema>;

export const setupRuleItemSchema = z.object({
	key: z.string().min(1).max(100),
	pattern: z.string().min(1),
	merchant: z.string(),
	categoryId: idSchema.nullable(),
	count: z.number().int(),
	totalCents: z.number().int(),
	totalText: z.string(),
	/** Recategorizar também os lançamentos antigos que casam. */
	applyToExisting: z.boolean(),
});
export type SetupRuleItem = z.infer<typeof setupRuleItemSchema>;

export const setupIncomeItemSchema = z.object({
	key: z.string().min(1).max(100),
	name: nameSchema,
	payer: z.string(),
	amountCents: positiveCentsSchema,
	amountText: z.string(),
	payday: dayOfMonthSchema,
	accountId: idSchema.nullable(),
});
export type SetupIncomeItem = z.infer<typeof setupIncomeItemSchema>;

/** O que o card mostra e o que o servidor guarda na proposta. */
export const setupProposalSchema = z.object({
	/** `ai` = nomes e categorias dados pela IA; `template` = sem IA (texto do banco limpo). */
	source: z.enum(["ai", "template"]),
	subscriptions: z.array(setupSubscriptionItemSchema).max(40),
	categoryRules: z.array(setupRuleItemSchema).max(40),
	income: setupIncomeItemSchema.nullable(),
	/** Aplicar o plano da renda ao orçamento (depois de criar a renda e as assinaturas). */
	plan: z.object({ reservePercent: z.number().int().min(0).max(100) }).nullable(),
});
export type SetupProposal = z.infer<typeof setupProposalSchema>;

/** O que o dono deixou marcado no card, com os nomes e categorias que editou. Nunca traz valor, dia nem data. */
export const setupSelectionSchema = z
	.object({
		subscriptions: z
			.array(z.object({ key: z.string().min(1).max(100), name: nameSchema, categoryId: idSchema }).strict())
			.max(40),
		categoryRules: z
			.array(
				z
					.object({ key: z.string().min(1).max(100), categoryId: idSchema, applyToExisting: z.boolean() })
					.strict(),
			)
			.max(40),
		income: z.object({ name: nameSchema }).strict().nullable(),
		applyPlan: z.boolean(),
	})
	.strict();
export type SetupSelection = z.infer<typeof setupSelectionSchema>;

/** `POST /v1/chat/proposals/:id/confirm`: o corpo é opcional; só a proposta `setup` usa `setup`. */
export const proposalConfirmBody = z.object({ setup: setupSelectionSchema.optional() }).strict();
export type ProposalConfirmBody = z.infer<typeof proposalConfirmBody>;

/** Tudo marcado, como a proposta veio (confirmar sem editar nada). */
export function fullSelection(proposal: SetupProposal): SetupSelection | { error: string } {
	for (const s of proposal.subscriptions) {
		if (s.categoryId === null) return { error: `Escolha a categoria de "${s.name}" ou desmarque.` };
	}
	for (const r of proposal.categoryRules) {
		if (r.categoryId === null) return { error: `Escolha a categoria de "${r.merchant}" ou desmarque.` };
	}
	return {
		subscriptions: proposal.subscriptions.map((s) => ({
			key: s.key,
			name: s.name,
			categoryId: s.categoryId as string,
		})),
		categoryRules: proposal.categoryRules.map((r) => ({
			key: r.key,
			categoryId: r.categoryId as string,
			applyToExisting: r.applyToExisting,
		})),
		income: proposal.income ? { name: proposal.income.name } : null,
		applyPlan: proposal.plan !== null,
	};
}

// -------------------------------------------------- aplicar e desfazer

/** O que o servidor grava: os números vêm SEMPRE da proposta (que os copiou da análise), nunca do pedido do app. */
export interface SetupApplyInput {
	subscriptions: Array<{
		key: string;
		name: string;
		categoryId: string;
		amountCents: number;
		dayOfMonth: number;
		startDate: string;
		accountId: string | null;
		cardId: string | null;
	}>;
	categoryRules: Array<{ key: string; pattern: string; categoryId: string; applyToExisting: boolean }>;
	income: { key: string; name: string; amountCents: number; payday: number; accountId: string | null } | null;
	plan: { reservePercent: number } | null;
}

/**
 * Cruza a proposta com o que o dono deixou marcado: só vale item que a proposta tem (chave conhecida); nome e
 * categoria vêm do dono, o resto da proposta. Devolve a mensagem em pt-BR quando algo não bate.
 */
export function resolveSetupSelection(
	proposal: SetupProposal,
	selection: SetupSelection,
): { ok: true; input: SetupApplyInput } | { ok: false; message: string } {
	const subs = new Map(proposal.subscriptions.map((s) => [s.key, s]));
	const rules = new Map(proposal.categoryRules.map((r) => [r.key, r]));
	const input: SetupApplyInput = { subscriptions: [], categoryRules: [], income: null, plan: null };
	const seen = new Set<string>();
	const once = (key: string) => {
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	};
	for (const pick of selection.subscriptions) {
		const item = subs.get(pick.key);
		if (!item || !once(pick.key)) return { ok: false, message: "Item de assinatura que a proposta não tem." };
		input.subscriptions.push({
			key: item.key,
			name: pick.name,
			categoryId: pick.categoryId,
			amountCents: item.amountCents,
			dayOfMonth: item.dayOfMonth,
			startDate: item.startDate,
			accountId: item.accountId,
			cardId: item.cardId,
		});
	}
	for (const pick of selection.categoryRules) {
		const item = rules.get(pick.key);
		if (!item || !once(pick.key)) return { ok: false, message: "Regra de categoria que a proposta não tem." };
		input.categoryRules.push({
			key: item.key,
			pattern: item.pattern,
			categoryId: pick.categoryId,
			applyToExisting: pick.applyToExisting,
		});
	}
	if (selection.income !== null) {
		const item = proposal.income;
		if (!item) return { ok: false, message: "A proposta não tem renda." };
		input.income = {
			key: item.key,
			name: selection.income.name,
			amountCents: item.amountCents,
			payday: item.payday,
			accountId: item.accountId,
		};
	}
	if (selection.applyPlan) {
		if (!proposal.plan) return { ok: false, message: "A proposta não tem o plano da renda." };
		input.plan = { reservePercent: proposal.plan.reservePercent };
	}
	if (
		input.subscriptions.length + input.categoryRules.length === 0 &&
		input.income === null &&
		input.plan === null
	) {
		return { ok: false, message: "Marque pelo menos um item para confirmar." };
	}
	return { ok: true, input };
}

/** O que `applySetup` anota para o Desfazer reverter tudo. */
export const setupUndoSchema = z.object({
	recurrenceIds: z.array(idSchema),
	rules: z.array(
		z.object({
			ruleId: idSchema,
			pattern: z.string().min(1),
			created: z.boolean(),
			previousCategoryId: idSchema.nullable(),
		}),
	),
	recategorized: z.array(
		z.object({
			transactionId: idSchema,
			previousCategoryId: idSchema.nullable(),
			categoryId: idSchema,
		}),
	),
	incomeId: idSchema.nullable(),
	previousBudgets: z.array(budgetBefore).nullable(),
});
export type SetupUndo = z.infer<typeof setupUndoSchema>;

/** O que o card mostra depois de confirmar: só o que foi aplicado, com os nomes e categorias finais. */
export function appliedView(proposal: SetupProposal, applied: SetupSelection): SetupProposal {
	const subs = new Map(applied.subscriptions.map((s) => [s.key, s]));
	const rules = new Map(applied.categoryRules.map((r) => [r.key, r]));
	return {
		source: proposal.source,
		subscriptions: proposal.subscriptions.flatMap((s) => {
			const pick = subs.get(s.key);
			return pick ? [{ ...s, name: pick.name, categoryId: pick.categoryId }] : [];
		}),
		categoryRules: proposal.categoryRules.flatMap((r) => {
			const pick = rules.get(r.key);
			return pick ? [{ ...r, categoryId: pick.categoryId, applyToExisting: pick.applyToExisting }] : [];
		}),
		income: proposal.income && applied.income ? { ...proposal.income, name: applied.income.name } : null,
		plan: applied.applyPlan ? proposal.plan : null,
	};
}
