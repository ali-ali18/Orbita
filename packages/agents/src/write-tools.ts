import { formatBRL, parseBRL } from "@orbita/core";
import { transactionApiCreateBody } from "@orbita/shared";
import { z } from "zod";
import { ToolError } from "./backend.ts";
import { dateInput, defineTool, nameOf, type Tool } from "./tool.ts";
import { untrusted } from "./untrusted.ts";

/*
 * Ferramentas de ESCRITA. Nenhuma grava: cada uma valida o pedido, confere que as referências existem e devolve
 * uma PROPOSTA. O app mostra um card com "Confirmar" e só depois o servidor executa (`proposals.ts`). O valor entra
 * como texto em reais ("46,90") e é convertido aqui para centavos: o modelo nunca multiplica por 100.
 */

const DESCRIPTION_MAX = 120;

export const proposeCreateTransaction = defineTool({
	name: "propose_create_transaction",
	label: "Preparando o lançamento…",
	access: "write",
	description:
		"Propõe lançar um gasto ou uma receita. NÃO grava: o dono confirma num card antes. Informe a conta OU o cartão " +
		"(use os ids de list_catalog); se faltar o valor ou onde foi, pergunte ao dono em vez de chutar. Para compras " +
		"parceladas ou transferências, diga que ainda não consegue pelo chat.",
	input: z.object({
		kind: z.enum(["expense", "income"]).describe("expense = gasto, income = receita."),
		amount: z
			.string()
			.min(1)
			.max(20)
			.describe('Valor em reais como o dono falou, ex.: "46,90" ou "1.250,00".'),
		description: z.string().min(1).max(DESCRIPTION_MAX).describe("Nome curto do lançamento, ex.: iFood."),
		date: dateInput.optional().describe("Ausente = hoje."),
		categoryId: z.string().max(64).optional().describe("Id da categoria (list_catalog)."),
		accountId: z.string().max(64).optional().describe("Id da conta. Não use junto com cardId."),
		cardId: z
			.string()
			.max(64)
			.optional()
			.describe("Id do cartão (só para gasto). Não use junto com accountId."),
	}),
	async run(input, ctx) {
		let amountCents: number;
		try {
			amountCents = parseBRL(input.amount);
		} catch {
			throw new ToolError(
				'Valor inválido. Use o formato 46,90 (vírgula nos centavos), sem "R$" colado em letras.',
			);
		}
		if (amountCents <= 0) throw new ToolError("O valor precisa ser maior que zero.");
		const catalog = await ctx.catalog();

		let accountId = input.accountId;
		const cardId = input.cardId;
		if (accountId && cardId) throw new ToolError("Informe a conta OU o cartão, não os dois.");
		if (!accountId && !cardId) {
			if (!catalog.defaultAccountId) {
				throw new ToolError("Falta dizer a conta ou o cartão. Pergunte ao dono onde foi o lançamento.");
			}
			accountId = catalog.defaultAccountId;
		}
		if (accountId && !catalog.accounts.some((a) => a.id === accountId)) {
			throw new ToolError("Conta não encontrada ou arquivada. Veja list_catalog.");
		}
		if (cardId && !catalog.cards.some((c) => c.id === cardId)) {
			throw new ToolError("Cartão não encontrado ou arquivado. Veja list_catalog.");
		}
		if (cardId && input.kind === "income") throw new ToolError("Receita não entra no cartão. Use uma conta.");
		if (input.categoryId && !catalog.categories.some((c) => c.id === input.categoryId)) {
			throw new ToolError("Categoria não encontrada ou arquivada. Veja list_catalog.");
		}

		const date = input.date ?? ctx.today;
		const parsed = transactionApiCreateBody.safeParse({
			kind: input.kind,
			amountCents,
			date,
			description: untrusted(input.description, DESCRIPTION_MAX),
			...(input.categoryId ? { categoryId: input.categoryId } : {}),
			...(accountId ? { accountId } : {}),
			...(cardId ? { cardId } : {}),
		});
		if (!parsed.success) throw new ToolError(parsed.error.issues[0]?.message ?? "Lançamento inválido.");

		const where = cardId
			? `${untrusted(nameOf(catalog.cards, cardId), 40)} (cartão)`
			: untrusted(nameOf(catalog.accounts, accountId ?? null), 40);
		const category = nameOf(catalog.categories, input.categoryId ?? null);
		const lines = [
			{ label: "Valor", value: formatBRL(input.kind === "expense" ? -amountCents : amountCents) },
			{ label: "Descrição", value: parsed.data.description },
			{ label: "Onde", value: where },
			{ label: "Data", value: date.split("-").reverse().join("/") },
			...(category ? [{ label: "Categoria", value: category }] : []),
		];
		const title = input.kind === "expense" ? "Lançar gasto" : "Lançar receita";
		return {
			data: {
				status: "aguardando_confirmacao",
				aviso: "Nada foi gravado. O dono precisa tocar em Confirmar no card.",
				resumo: lines,
			},
			proposal: { kind: "create_transaction", payload: { input: parsed.data }, title, lines },
		};
	},
});

export const proposeCategorizeTransaction = defineTool({
	name: "propose_categorize_transaction",
	label: "Preparando a troca de categoria…",
	access: "write",
	description:
		"Propõe trocar a categoria de um lançamento que já existe. NÃO grava: o dono confirma num card. Use o id do " +
		"lançamento (de search_transactions) e o id da categoria (de list_catalog).",
	input: z.object({
		transactionId: z.string().min(1).max(64),
		categoryId: z.string().min(1).max(64),
	}),
	async run(input, ctx) {
		const [catalog, transaction] = await Promise.all([
			ctx.catalog(),
			ctx.reader.getTransaction(input.transactionId),
		]);
		if (!transaction) throw new ToolError("Lançamento não encontrado.");
		const category = catalog.categories.find((c) => c.id === input.categoryId);
		if (!category) throw new ToolError("Categoria não encontrada ou arquivada. Veja list_catalog.");
		if (transaction.categoryId === category.id) {
			throw new ToolError(`Esse lançamento já está em ${category.name}.`);
		}
		if (transaction.kind === "transfer" || transaction.kind === "card_payment") {
			throw new ToolError("Transferência e pagamento de fatura não têm categoria.");
		}
		const before = nameOf(catalog.categories, transaction.categoryId) ?? "Sem categoria";
		const lines = [
			{ label: "Lançamento", value: untrusted(transaction.description, 60) },
			{
				label: "Valor",
				value: formatBRL(transaction.kind === "expense" ? -transaction.amountCents : transaction.amountCents),
			},
			{ label: "Categoria", value: `${before} → ${category.name}` },
		];
		return {
			data: {
				status: "aguardando_confirmacao",
				aviso: "Nada foi alterado. O dono precisa tocar em Confirmar no card.",
				resumo: lines,
			},
			proposal: {
				kind: "categorize_transaction",
				payload: { transactionId: transaction.id, categoryId: category.id },
				title: "Trocar categoria",
				lines,
			},
		};
	},
});

export const proposeConfirmTransaction = defineTool({
	name: "propose_confirm_transaction",
	label: "Preparando a confirmação…",
	access: "write",
	description:
		"Propõe confirmar um lançamento que está pendente de revisão (veio de notificação ou extrato). NÃO confirma " +
		"sozinha: o dono toca em Confirmar no card. Use o id de search_transactions com status pending.",
	input: z.object({ transactionId: z.string().min(1).max(64) }),
	async run(input, ctx) {
		const [catalog, transaction] = await Promise.all([
			ctx.catalog(),
			ctx.reader.getTransaction(input.transactionId),
		]);
		if (!transaction) throw new ToolError("Lançamento não encontrado.");
		if (transaction.status !== "pending") throw new ToolError("Esse lançamento já está confirmado.");
		const lines = [
			{ label: "Lançamento", value: untrusted(transaction.description, 60) },
			{
				label: "Valor",
				value: formatBRL(transaction.kind === "expense" ? -transaction.amountCents : transaction.amountCents),
			},
			{ label: "Data", value: transaction.date.split("-").reverse().join("/") },
			...(nameOf(catalog.categories, transaction.categoryId)
				? [{ label: "Categoria", value: nameOf(catalog.categories, transaction.categoryId) as string }]
				: []),
		];
		return {
			data: {
				status: "aguardando_confirmacao",
				aviso: "Nada foi confirmado. O dono precisa tocar em Confirmar no card.",
				resumo: lines,
			},
			proposal: {
				kind: "confirm_transaction",
				payload: { transactionId: transaction.id },
				title: "Confirmar lançamento",
				lines,
			},
		};
	},
});

export const WRITE_TOOLS: readonly Tool[] = [
	proposeCreateTransaction,
	proposeCategorizeTransaction,
	proposeConfirmTransaction,
];
