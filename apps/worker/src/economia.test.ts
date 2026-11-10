import {
	DEFAULT_CHAT_MODEL_CONFIG,
	type ModelClient,
	type ModelRequest,
	type ModelResponse,
	type TurnHandlers,
} from "@orbita/agents";
import { createMemoryStores, type Stores } from "@orbita/db";
import { beforeEach, describe, expect, it } from "vitest";
import { type RunAgentsDeps, runDueAgents } from "./alertas.ts";

// 2026-11-08 12:00 UTC = 09:00 em São Paulo (domingo). A agenda semanal do Economia é a segunda; a última caiu dia 2.
const NOW = new Date("2026-11-08T12:00:00Z");

let stores: Stores;
let logs: string[];

/** Cliente falso que reescreve cada item `N: texto` como `N: <prefixo> texto` (e, se pedido, acrescenta um valor inventado). */
function rewritingClient(options: { invent?: boolean } = {}) {
	const client: ModelClient = {
		async turn(request: ModelRequest, handlers: TurnHandlers): Promise<ModelResponse> {
			const input = String(request.messages.at(-1)?.content ?? "");
			const text = input
				.split("\n")
				.map((line) => {
					const m = /^(\d+): (.*)$/.exec(line);
					return m
						? `${m[1]}: Resumo da semana. ${m[2]}${options.invent ? " Dá para guardar R$ 999,00." : ""}`
						: "";
				})
				.join("\n");
			handlers.onText(text);
			return {
				content: [{ type: "text", text }],
				stopReason: "end_turn",
				model: request.model,
				usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 },
			};
		},
	};
	return client;
}

function deps(over: Partial<RunAgentsDeps> = {}): RunAgentsDeps {
	return {
		stores,
		now: () => NOW,
		readApiKey: async () => null,
		createClient: () => {
			throw new Error("não deveria criar cliente");
		},
		models: DEFAULT_CHAT_MODEL_CONFIG,
		aiWording: true,
		log: (line) => logs.push(line),
		...over,
	};
}

async function seed() {
	await stores.categories.ensureDefaults();
	const categories = await stores.categories.list();
	const cat = (slug: string) => categories.find((c) => c.slug === slug)?.id as string;
	const account = await stores.accounts.create({ name: "Conta", kind: "checking" });
	const add = (date: string, amountCents: number, description: string, slug: string | null) =>
		stores.transactions.create({
			kind: "expense",
			amountCents,
			date,
			description,
			accountId: account.id,
			categoryId: slug === null ? null : cat(slug),
		});
	for (const [i, month] of ["2026-08", "2026-09", "2026-10"].entries()) {
		await add(`${month}-1${i}`, 30000, `Cinema ${i}`, "lazer");
	}
	await add("2026-11-03", 45000, "Show", "lazer");
	await add("2026-11-01", 20000, "JUROS DE MORA", "outros");
	await stores.categoryRules.upsert("padaria estrela", cat("mercado"));
	const padaria = await add("2026-11-07", 3200, "Padaria Estrela", null);
	return { cat, padaria, account };
}

async function economia(settings: Record<string, unknown> = {}, enabled = true) {
	await runDueAgents(deps());
	const agent = (await stores.agents.list()).find((a) => a.builtinKey === "economia");
	if (!agent) throw new Error("sem agente Economia");
	await stores.agents.update(agent.id, { enabled, settings });
	return agent;
}

beforeEach(() => {
	stores = createMemoryStores();
	logs = [];
});

describe("agente Economia no worker", () => {
	it("desligado, não roda e não grava nada", async () => {
		await seed();
		await economia({}, false);
		expect(await runDueAgents(deps())).toMatchObject({ ran: 0, created: 0, actions: 0 });
		expect(await stores.agents.listAlerts()).toEqual([]);
	});

	it("'Só avisar' (padrão): gera o relatório e os avisos com texto-modelo, sem agir nem registrar atividade", async () => {
		const { padaria } = await seed();
		const agent = await economia();
		const result = await runDueAgents(deps());
		expect(result).toMatchObject({ ran: 1, failed: 0, actions: 0 });
		const alerts = await stores.agents.listAlerts({ agentId: agent.id });
		const kinds = alerts.map((a) => a.kind);
		expect(kinds).toContain("savings_report");
		expect(kinds).toContain("savings_opportunity");
		const report = alerts.find((a) => a.kind === "savings_report");
		expect(report?.title).toBe("Dá para cortar até R$ 66,66 por mês");
		expect(report?.body).toContain("Achei");
		expect(report?.wordedByAi).toBe(false);
		// Nada foi feito sozinho.
		expect(await stores.agentActivity.list()).toEqual([]);
		expect((await stores.transactions.get(padaria.id))?.categoryId).toBeNull();
		expect(await stores.budgets.list()).toEqual([]);
		expect((await stores.agents.get(agent.id))?.lastRunAt).toEqual(NOW);
	});

	it("não roda de novo no mesmo período e rodar de novo não duplica os avisos", async () => {
		await seed();
		const agent = await economia();
		await runDueAgents(deps());
		const count = (await stores.agents.listAlerts({ agentId: agent.id })).length;
		expect(await runDueAgents(deps())).toMatchObject({ ran: 0, created: 0 });
		await stores.agents.markRun(agent.id, new Date("2026-11-01T00:00:00Z"));
		expect(await runDueAgents(deps())).toMatchObject({ ran: 1, created: 0 });
		expect(await stores.agents.listAlerts({ agentId: agent.id })).toHaveLength(count);
	});

	it("'Agir no que é reversível': age, registra no log com motivo e evidência e conta as ações", async () => {
		const { padaria, cat } = await seed();
		await economia({ autonomy: "reversible", maxActionsPerRun: 10 });
		const result = await runDueAgents(deps());
		expect(result.actions).toBeGreaterThanOrEqual(2);
		expect((await stores.transactions.get(padaria.id))?.categoryId).toBe(cat("mercado"));
		expect((await stores.budgets.list()).find((b) => b.scope === cat("lazer"))?.limitCents).toBe(30000);
		const log = await stores.agentActivity.list();
		expect(log).toHaveLength(result.actions);
		expect(log.find((a) => a.kind === "categorize_transaction")).toMatchObject({
			status: "done",
			reason: "Uma regra que você ensinou casa com o estabelecimento.",
			evidence: { transactionIds: [padaria.id] },
		});
	});

	it("depois de agir, o aviso não oferece mais o que o agente acabou de resolver (leitura refeita)", async () => {
		const { cat } = await seed();
		const agent = await economia({ autonomy: "reversible", maxActionsPerRun: 10 });
		await runDueAgents(deps());
		expect((await stores.budgets.list()).some((b) => b.scope === cat("lazer"))).toBe(true);
		const alerts = await stores.agents.listAlerts({ agentId: agent.id });
		const lazer = alerts.find(
			(a) => a.kind === "savings_opportunity" && a.data.type === "category_above_average",
		);
		expect(lazer).toBeDefined();
		// O limite já foi criado pelo agente: "Criar limite" não pode aparecer como pendência.
		expect(lazer?.data.actions).toEqual(["ignore"]);
	});

	it("o teto de ações por execução vale", async () => {
		await seed();
		await economia({ autonomy: "reversible", maxActionsPerRun: 1 });
		expect((await runDueAgents(deps())).actions).toBe(1);
		expect(await stores.agentActivity.list()).toHaveLength(1);
	});

	it("uma falha ao agir não derruba o aviso: o agente segue e conta a falha no log", async () => {
		const { padaria } = await seed();
		await economia({ autonomy: "reversible", maxActionsPerRun: 10 });
		const broken: Stores = {
			...stores,
			transactions: {
				...stores.transactions,
				update: async (id, patch) => {
					if (id === padaria.id) throw new Error("banco caiu");
					return stores.transactions.update(id, patch);
				},
			},
		};
		const result = await runDueAgents(deps({ stores: broken }));
		expect(result.ran).toBe(1);
		expect(result.created).toBeGreaterThan(0);
		expect(logs.join("\n")).toContain("falharam");
		// O registro NÃO some: fica em andamento, com o Desfazer, até a próxima passada resolver.
		const economiaId = (await stores.agents.list()).find((x) => x.builtinKey === "economia")?.id as string;
		const mine = (await stores.agentActivity.list({ agentId: economiaId })).find(
			(x) => x.dedupeKey === `categorize:${padaria.id}`,
		);
		expect(mine?.status).toBe("applying");
		// Próxima passada (banco são): nada tinha sido gravado, então refaz e conclui.
		await stores.agents.markRun(economiaId, new Date("2026-10-01T00:00:00Z"));
		await runDueAgents(deps());
		const again = (await stores.agentActivity.list({ agentId: economiaId })).find(
			(x) => x.dedupeKey === `categorize:${padaria.id}`,
		);
		expect(again?.status).toBe("done");
	});

	it("a IA só reescreve o texto: se trouxer número inventado, vale o texto-modelo", async () => {
		await seed();
		await economia();
		const ok = await runDueAgents(
			deps({ readApiKey: async () => "sk", createClient: () => rewritingClient() }),
		);
		expect(ok.worded).toBeGreaterThan(0);
		const reworded = (await stores.agents.listAlerts()).filter((a) => a.wordedByAi);
		expect(reworded.length).toBeGreaterThan(0);
		for (const a of reworded) expect(a.body.startsWith("Resumo da semana.")).toBe(true);
	});

	it("texto reescrito com valor que o engine não calculou é descartado", async () => {
		await seed();
		await economia();
		const bad = await runDueAgents(
			deps({ readApiKey: async () => "sk", createClient: () => rewritingClient({ invent: true }) }),
		);
		expect(bad.worded).toBe(0);
		const alerts = await stores.agents.listAlerts();
		expect(alerts.every((a) => !a.wordedByAi && !a.body.includes("999"))).toBe(true);
	});

	it("ao fechar a fatura de um cartão, roda no dia seguinte mesmo fora da agenda semanal", async () => {
		await seed();
		const agent = await economia();
		await stores.cards.create({ name: "Cartão", closingDay: 5, dueDay: 12 });
		// A agenda já foi atendida (rodou dia 3, depois da segunda); o fechamento foi dia 5.
		await stores.agents.markRun(agent.id, new Date("2026-11-03T12:00:00Z"));
		expect(await runDueAgents(deps())).toMatchObject({ ran: 1 });
		expect((await stores.agents.get(agent.id))?.lastRunAt).toEqual(NOW);
		// Já rodou depois do fechamento: não repete.
		expect(await runDueAgents(deps())).toMatchObject({ ran: 0 });
	});

	it("com 'Ao fechar fatura' desligado, só a agenda semanal vale", async () => {
		await seed();
		const agent = await economia({ onInvoiceClose: false });
		await stores.cards.create({ name: "Cartão", closingDay: 5, dueDay: 12 });
		await stores.agents.markRun(agent.id, new Date("2026-11-03T12:00:00Z"));
		expect(await runDueAgents(deps())).toMatchObject({ ran: 0 });
	});
});
