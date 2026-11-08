import { formatBRL } from "@orbita/core";
import { DEFAULT_PLAN_RESERVE_PERCENT } from "@orbita/shared";
import { z } from "zod";
import { ToolError } from "./backend.ts";
import { defineTool, money, monthInput } from "./tool.ts";
import { untrusted } from "./untrusted.ts";

/*
 * Plano da renda. `income_plan` só LÊ (o plano é do engine, `incomePlan` em `@orbita/core`). `propose_apply_plan`
 * nunca grava: devolve uma proposta que o dono confirma no card, e só então o servidor escreve o orçamento.
 */

const reserveInput = z
	.number()
	.int()
	.min(0)
	.max(100)
	.optional()
	.describe(`Percentual da renda para a reserva (0 a 100). Ausente = ${DEFAULT_PLAN_RESERVE_PERCENT}.`);

export const getIncomePlan = defineTool({
	name: "income_plan",
	label: "Montando o plano da renda…",
	access: "read",
	description:
		"Plano do mês a partir da renda cadastrada, calculado pelo engine: renda, compromissos fixos (assinaturas, " +
		"parcelas da fatura), gasto do dia a dia, valor mensal das metas, reserva, sobra e os limites por categoria " +
		"sugeridos, com avisos (compromissos acima da renda, sugestão reduzida para caber). Use para 'como organizo " +
		"meu mês', 'quanto posso gastar com o meu salário', 'o que sobra da minha renda'. Sem renda cadastrada, " +
		"diga que o dono cadastra a renda em Configurações → Perfil → Renda.",
	input: z.object({ month: monthInput.optional(), reservePercent: reserveInput }),
	async run(input, ctx) {
		const month = input.month ?? ctx.currentMonth;
		const plan = await ctx.reader.incomePlan(month, input.reservePercent);
		const b = plan.buckets;
		const rows = [
			{ label: "Renda do mês", caption: null, value: formatBRL(plan.incomeCents), cents: plan.incomeCents },
			{
				label: "Compromissos fixos",
				caption: "assinaturas e parcelas",
				value: formatBRL(b.commitmentsCents),
				cents: b.commitmentsCents,
			},
			{ label: "Dia a dia", caption: null, value: formatBRL(b.dailyCents), cents: b.dailyCents },
			{ label: "Metas", caption: null, value: formatBRL(b.goalsCents), cents: b.goalsCents },
			{
				label: "Reserva",
				caption: `${plan.reservePercent}% da renda`,
				value: formatBRL(b.reserveCents),
				cents: b.reserveCents,
			},
			{ label: "Sobra", caption: null, value: formatBRL(b.leftCents), cents: Math.max(0, b.leftCents) },
		];
		return {
			data: {
				month,
				feasible: plan.feasible,
				income: money(plan.incomeCents),
				reservePercent: plan.reservePercent,
				buckets: {
					commitments: money(b.commitmentsCents),
					daily: money(b.dailyCents),
					goals: money(b.goalsCents),
					reserve: money(b.reserveCents),
					left: money(b.leftCents),
				},
				budgetTotal: money(plan.budget.totalCents),
				categories: plan.categories.slice(0, 12).map((c) => ({
					name: untrusted(c.name, 40),
					commitments: money(c.commitmentsCents),
					daily: money(c.dailyCents),
					limit: money(c.totalCents),
				})),
				commitments: plan.commitments.slice(0, 15).map((c) => ({
					// Nome vindo de lançamento ou recorrência: dado, nunca instrução.
					name: untrusted(c.name, 60),
					amount: money(c.amountCents),
					source: c.source,
				})),
				goals: plan.goals.map((g) => ({ name: untrusted(g.name, 60), monthly: money(g.amountCents) })),
				warnings: plan.warnings.map((w) => w.message),
				wouldReplaceLimits: plan.replacesCount,
			},
			card: {
				type: "rows",
				tool: "income_plan",
				title: `Plano da renda · ${month}`,
				rows,
				total: null,
			},
		};
	},
});

export const proposeApplyPlan = defineTool({
	name: "propose_apply_plan",
	label: "Preparando o orçamento…",
	access: "write",
	description:
		"Propõe gravar o plano da renda no orçamento do mês (total e limite por categoria). NÃO grava: o dono confirma " +
		"num card e pode desfazer depois. Chame income_plan antes e só proponha se o plano for viável e o dono pediu " +
		"para organizar ou aplicar o orçamento.",
	input: z.object({ month: monthInput.optional(), reservePercent: reserveInput }),
	async run(input, ctx) {
		const month = input.month ?? ctx.currentMonth;
		if (month < ctx.currentMonth) {
			throw new ToolError("Só dá para aplicar o plano do mês atual ou de um mês futuro.");
		}
		const plan = await ctx.reader.incomePlan(month, input.reservePercent);
		if (!plan.feasible) {
			throw new ToolError(plan.warnings[0]?.message ?? "Não há plano para aplicar neste mês.");
		}
		if (plan.budget.totalCents <= 0) {
			throw new ToolError("Ainda não há gastos nem compromissos para montar os limites.");
		}
		const catalogNames = plan.categories.slice(0, 6).map((c) => ({
			label: untrusted(c.name, 40),
			value: formatBRL(c.totalCents),
		}));
		const lines = [
			{ label: "Renda", value: formatBRL(plan.incomeCents) },
			{ label: "Limite do mês", value: formatBRL(plan.budget.totalCents) },
			...catalogNames,
			{ label: "Metas", value: formatBRL(plan.buckets.goalsCents) },
			{ label: "Reserva", value: `${formatBRL(plan.buckets.reserveCents)} (${plan.reservePercent}%)` },
			...(plan.replacesCount > 0
				? [{ label: "Troca", value: `${plan.replacesCount} limite(s) que você já definiu` }]
				: []),
		];
		return {
			data: {
				status: "aguardando_confirmacao",
				aviso: "Nada foi gravado. O dono precisa tocar em Confirmar no card.",
				resumo: lines,
			},
			proposal: {
				kind: "apply_plan",
				payload: { month, reservePercent: plan.reservePercent },
				title: "Aplicar o plano ao orçamento",
				lines,
			},
		};
	},
});
