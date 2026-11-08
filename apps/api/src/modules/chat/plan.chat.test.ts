import type { ModelBlock, ModelClient, ModelRequest } from "@orbita/agents";
import { describe, expect, it } from "vitest";
import { type Json, setupFinance } from "../../test-support.ts";

const KEY = "sk-ant-api03-ZzYyXxWwVvUuTtSsRrQqPp9876543210";

type Step = (request: ModelRequest) => { content: ModelBlock[]; stopReason: string; text?: string[] };

/** Cliente falso do modelo: nenhuma chamada sai para a rede. */
function scripted(steps: Step[]) {
	let i = 0;
	const factory = (): ModelClient => ({
		async turn(request, handlers) {
			const step = steps[i];
			i += 1;
			if (!step) throw new Error("sem resposta combinada");
			const out = step(request);
			for (const piece of out.text ?? []) handlers.onText(piece);
			return {
				content: out.content,
				stopReason: out.stopReason,
				model: request.model,
				usage: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 },
			};
		},
	});
	return factory;
}

const use = (id: string, name: string, input: unknown): ModelBlock => ({ type: "tool_use", id, name, input });

async function chat(ctx: Awaited<ReturnType<typeof setupFinance>>, message: string) {
	const res = await ctx.app.request("/v1/chat", {
		method: "POST",
		headers: { authorization: `Bearer ${ctx.token}`, "content-type": "application/json" },
		body: JSON.stringify({ message }),
	});
	const raw = await res.text();
	return raw
		.split("\n\n")
		.map((block) => block.split("\n").find((line) => line.startsWith("data:")))
		.filter((line): line is string => Boolean(line))
		.map((line) => JSON.parse(line.slice(5).trim()) as Json);
}

describe("chat: plano da renda", () => {
	it("income_plan lê o plano do engine e propose_apply_plan só propõe; confirmar grava e desfazer restaura", async () => {
		const ctx = await setupFinance(undefined, undefined, {
			chatClient: scripted([
				() => ({
					content: [use("r1", "income_plan", {}), use("w1", "propose_apply_plan", {})],
					stopReason: "tool_use",
				}),
				() => ({
					content: [{ type: "text", text: "Confirme no card." }],
					stopReason: "end_turn",
					text: ["Confirme no card."],
				}),
			]),
		});
		await ctx.vault.put("anthropic_api_key", KEY, "Teste");
		const b = await ctx.basics();
		for (const month of ["2026-08", "2026-09", "2026-10"]) {
			for (const [day, cents, slug] of [
				["10", 150000, "mercado"],
				["11", 127500, "lazer"],
			] as const) {
				await ctx.api.post("/v1/transactions", {
					kind: "expense",
					amountCents: cents,
					date: `${month}-${day}`,
					description: `gasto ${slug}`,
					accountId: b.account.id,
					categoryId: b.category(slug),
				});
			}
		}
		await ctx.api.post("/v1/income", { name: "Salário", amountCents: 230000, payday: 5 });
		await ctx.api.put("/v1/budgets", { scope: "total", limitCents: 230000 });

		const events = await chat(ctx, "organiza meu mês com o meu salário");
		const rows = events.find((e) => e.type === "card" && e.card.type === "rows");
		expect(rows.card.tool).toBe("income_plan");
		const proposal = events.find((e) => e.type === "card" && e.card.type === "proposal").card.proposal;
		expect(proposal).toMatchObject({
			kind: "apply_plan",
			status: "pending",
			title: "Aplicar o plano ao orçamento",
		});
		expect(proposal.lines).toContainEqual({ label: "Limite do mês", value: "R$ 2.070,00" });
		expect(proposal.lines).toContainEqual({ label: "Troca", value: "1 limite(s) que você já definiu" });

		// Proposta não grava: o total segue o de antes.
		const before = (await ctx.api.get("/v1/budgets")).body.budgets;
		expect(before).toHaveLength(1);
		expect(before[0].limitCents).toBe(230000);

		const confirmed = await ctx.api.post(`/v1/chat/proposals/${proposal.id}/confirm`);
		expect(confirmed.body.proposal.status).toBe("confirmed");
		const applied = (await ctx.api.get("/v1/budgets")).body.budgets as Json[];
		const total = applied.find((x) => x.scope === "total").limitCents;
		const parts = applied.filter((x) => x.scope !== "total").reduce((s, x) => s + x.limitCents, 0);
		expect(total).toBe(207000);
		expect(parts).toBe(total);

		const undone = await ctx.api.post(`/v1/chat/proposals/${proposal.id}/undo`);
		expect(undone.body.proposal.status).toBe("undone");
		const restored = (await ctx.api.get("/v1/budgets")).body.budgets as Json[];
		expect(restored.map((x) => [x.scope, x.limitCents])).toEqual([["total", 230000]]);
	});
});
