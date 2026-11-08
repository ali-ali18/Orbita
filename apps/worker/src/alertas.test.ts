import {
	DEFAULT_CHAT_MODEL_CONFIG,
	type ModelClient,
	type ModelRequest,
	type ModelResponse,
	type TurnHandlers,
} from "@orbita/agents";
import { createMemoryStores, type Stores } from "@orbita/db";
import { beforeEach, describe, expect, it } from "vitest";
import { builtinSeeds, type RunAgentsDeps, runDueAgents } from "./alertas.ts";

// 2026-11-08 12:00 UTC = 09:00 em São Paulo (domingo).
const NOW = new Date("2026-11-08T12:00:00Z");

type Step = (request: ModelRequest) => { text?: string; stopReason?: string };

/** Cliente falso: nenhum teste chama a Anthropic de verdade. */
function fakeClient(steps: Step[] = []) {
	const requests: ModelRequest[] = [];
	let i = 0;
	const client: ModelClient = {
		async turn(request: ModelRequest, handlers: TurnHandlers): Promise<ModelResponse> {
			requests.push(structuredClone(request));
			const step = steps[i];
			i += 1;
			if (!step) throw new Error("sem resposta combinada");
			const out = step(request);
			if (out.text) handlers.onText(out.text);
			return {
				content: out.text ? [{ type: "text", text: out.text }] : [],
				stopReason: out.stopReason ?? "end_turn",
				model: request.model,
				usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 },
			};
		},
	};
	return { client, requests };
}

let stores: Stores;
let logs: string[];
let clientCalls: number;

function deps(over: Partial<RunAgentsDeps> = {}): RunAgentsDeps {
	return {
		stores,
		now: () => NOW,
		readApiKey: async () => null,
		createClient: () => {
			clientCalls += 1;
			throw new Error("não deveria criar cliente");
		},
		models: DEFAULT_CHAT_MODEL_CONFIG,
		aiWording: true,
		log: (line) => logs.push(line),
		...over,
	};
}

async function agentOf(key: string) {
	const found = (await stores.agents.list()).find((a) => a.builtinKey === key);
	if (!found) throw new Error(`sem agente ${key}`);
	return found;
}

/** Delivery com orçamento de R$ 500,00 e R$ 450,00 gastos em novembro: passou de 80 %. */
async function seedBudgetNearLimit() {
	await stores.categories.ensureDefaults();
	const delivery = (await stores.categories.list()).find((c) => c.slug === "delivery");
	const account = await stores.accounts.create({ name: "Conta", kind: "checking" });
	if (!delivery) throw new Error("sem categoria delivery");
	await stores.budgets.set(delivery.id, 50000);
	for (const [date, amountCents, description] of [
		["2026-11-03", 25000, "Restaurante A"],
		["2026-11-05", 20000, "Restaurante B"],
	] as const) {
		await stores.transactions.create({
			kind: "expense",
			amountCents,
			date,
			description,
			categoryId: delivery.id,
			accountId: account.id,
		});
	}
	return delivery;
}

beforeEach(() => {
	stores = createMemoryStores();
	logs = [];
	clientCalls = 0;
});

describe("runDueAgents", () => {
	it("cria os agentes da casa e, com todos desligados, não roda nada", async () => {
		const result = await runDueAgents(deps());
		expect(result).toEqual({ ran: 0, created: 0, worded: 0, failed: 0 });
		expect((await stores.agents.list()).map((a) => a.builtinKey)).toEqual([
			"orbita",
			"vigia",
			"fechamento",
			"metas",
			"caca_assinatura",
			"cofrinho",
		]);
		expect(builtinSeeds()).toHaveLength(6);
	});

	it("roda o Vigia na hora, grava o aviso com texto-modelo (sem chave) e anota a execução", async () => {
		const delivery = await seedBudgetNearLimit();
		await runDueAgents(deps());
		const vigia = await agentOf("vigia");
		await stores.agents.update(vigia.id, { enabled: true });

		const result = await runDueAgents(deps());
		expect(result).toEqual({ ran: 1, created: 1, worded: 0, failed: 0 });
		const [alert] = await stores.agents.listAlerts();
		expect(alert).toMatchObject({
			agentId: vigia.id,
			kind: "budget_threshold",
			dedupeKey: `budget:${delivery.id}:2026-11:alert`,
			title: "Delivery passou de 80% do orçamento",
			body: "Delivery já gastou R$ 450,00 de R$ 500,00. Ainda cabem R$ 50,00.",
			status: "new",
			wordedByAi: false,
		});
		expect((await agentOf("vigia")).lastRunAt).toEqual(NOW);
		expect(clientCalls).toBe(0);
	});

	it("não roda de novo no mesmo período e, se rodar, não duplica o aviso", async () => {
		await seedBudgetNearLimit();
		await runDueAgents(deps());
		const vigia = await agentOf("vigia");
		await stores.agents.update(vigia.id, { enabled: true });
		await runDueAgents(deps());
		// Mesma hora: não está na hora de novo.
		expect(await runDueAgents(deps())).toMatchObject({ ran: 0, created: 0 });
		// Mesmo se o relógio de execução se perdesse, o achado já existe e não vira um segundo aviso.
		await stores.agents.markRun(vigia.id, new Date("2026-11-01T00:00:00Z"));
		expect(await runDueAgents(deps())).toEqual({ ran: 1, created: 0, worded: 0, failed: 0 });
		expect(await stores.agents.listAlerts()).toHaveLength(1);
	});

	it("não roda antes da hora da agenda", async () => {
		await seedBudgetNearLimit();
		await runDueAgents(deps());
		const vigia = await agentOf("vigia");
		await stores.agents.update(vigia.id, { enabled: true });
		await stores.agents.markRun(vigia.id, new Date("2026-11-08T11:30:00Z")); // 08:30 em SP, antes das 9h
		const early = new Date("2026-11-08T11:45:00Z");
		expect(await runDueAgents(deps({ now: () => early }))).toMatchObject({ ran: 0 });
	});

	it("com chave e dentro do limite, a IA reescreve o texto; o custo entra no limite do mês", async () => {
		await seedBudgetNearLimit();
		await runDueAgents(deps());
		const vigia = await agentOf("vigia");
		await stores.agents.update(vigia.id, { enabled: true, model: "claude-opus-5-5" });
		const { client, requests } = fakeClient([
			() => ({
				text: "1: A categoria Delivery já está em R$ 450,00 dos R$ 500,00 do orçamento. Ainda cabem R$ 50,00.",
			}),
		]);
		const result = await runDueAgents(
			deps({ readApiKey: async () => "sk-teste", createClient: () => client }),
		);
		expect(result).toEqual({ ran: 1, created: 1, worded: 1, failed: 0 });
		const [alert] = await stores.agents.listAlerts();
		expect(alert).toMatchObject({
			body: "A categoria Delivery já está em R$ 450,00 dos R$ 500,00 do orçamento. Ainda cabem R$ 50,00.",
			wordedByAi: true,
		});
		expect(requests).toHaveLength(1);
		// O modelo do agente (da lista permitida) vale; a chamada não leva ferramentas.
		expect(requests[0]).toMatchObject({ model: "claude-opus-5-5", tools: [] });
		const totals = await stores.aiUsage.monthTotals("2026-11");
		expect(totals.costMicroUsd).toBeGreaterThan(0);
	});

	it("texto da IA com número diferente é descartado e o modelo fica", async () => {
		await seedBudgetNearLimit();
		await runDueAgents(deps());
		const vigia = await agentOf("vigia");
		await stores.agents.update(vigia.id, { enabled: true });
		const { client } = fakeClient([() => ({ text: "1: Delivery já gastou R$ 460,00 de R$ 500,00." })]);
		const result = await runDueAgents(deps({ readApiKey: async () => "sk", createClient: () => client }));
		expect(result.worded).toBe(0);
		const [alert] = await stores.agents.listAlerts();
		expect(alert).toMatchObject({
			wordedByAi: false,
			body: "Delivery já gastou R$ 450,00 de R$ 500,00. Ainda cabem R$ 50,00.",
		});
	});

	it("acima do limite mensal, o aviso sai com o texto-modelo e a IA nem é chamada", async () => {
		await seedBudgetNearLimit();
		await runDueAgents(deps());
		await stores.agents.update((await agentOf("vigia")).id, { enabled: true });
		await stores.aiUsage.setMonthlyLimit(0);
		const { client, requests } = fakeClient([]);
		const result = await runDueAgents(deps({ readApiKey: async () => "sk", createClient: () => client }));
		expect(result).toEqual({ ran: 1, created: 1, worded: 0, failed: 0 });
		expect(requests).toHaveLength(0);
		expect((await stores.agents.listAlerts())[0]?.wordedByAi).toBe(false);
	});

	it("chave ilegível ou reescrita desligada também deixam o texto-modelo", async () => {
		await seedBudgetNearLimit();
		await runDueAgents(deps());
		const vigia = await agentOf("vigia");
		await stores.agents.update(vigia.id, { enabled: true });
		const result = await runDueAgents(
			deps({
				readApiKey: async () => {
					throw new Error("segredo ilegível");
				},
			}),
		);
		expect(result).toMatchObject({ ran: 1, created: 1, worded: 0, failed: 0 });

		await stores.agents.markRun(vigia.id, new Date("2026-11-01T00:00:00Z"));
		await stores.agents.update(vigia.id, { settings: { ...vigia.settings, unusualMinCents: 100 } });
		const { client, requests } = fakeClient([]);
		await runDueAgents(deps({ aiWording: false, readApiKey: async () => "sk", createClient: () => client }));
		expect(requests).toHaveLength(0);
	});

	it("o Cofrinho só sugere: grava aviso e nenhum lançamento ou proposta", async () => {
		await stores.categories.ensureDefaults();
		await stores.budgets.set("total", 400000);
		const account = await stores.accounts.create({ name: "Conta", kind: "checking" });
		await stores.transactions.create({
			kind: "expense",
			amountCents: 100000,
			date: "2026-11-02",
			description: "Aluguel",
			accountId: account.id,
		});
		await runDueAgents(deps());
		const cofrinho = await agentOf("cofrinho");
		await stores.agents.update(cofrinho.id, { enabled: true, runDay: 1 });
		const before = await stores.transactions.listByBudgetMonth("2026-11");
		const result = await runDueAgents(deps());
		expect(result).toMatchObject({ ran: 1, created: 1 });
		const [alert] = await stores.agents.listAlerts();
		expect(alert).toMatchObject({
			kind: "saving_suggestion",
			dedupeKey: "saving:2026-11",
			proposalId: null,
			transactionId: null,
		});
		expect(await stores.transactions.listByBudgetMonth("2026-11")).toEqual(before);
	});

	describe("agente do dono", () => {
		const custom = {
			name: "Bar",
			instructions: "Me avisa se eu gastar muito em bar.",
			tools: ["get_month_summary"],
			frequency: "daily" as const,
			runHour: 9,
			runDay: null,
		};

		it("sem chave não roda nem marca como rodado (tenta de novo na próxima passada)", async () => {
			const agent = await stores.agents.createCustom(custom);
			const result = await runDueAgents(deps());
			expect(result).toEqual({ ran: 0, created: 0, worded: 0, failed: 0 });
			expect((await stores.agents.get(agent.id))?.lastRunAt).toBeNull();
		});

		it("com chave, segue as instruções do dono, grava um aviso por período e conta no custo", async () => {
			const agent = await stores.agents.createCustom(custom);
			const { client, requests } = fakeClient([() => ({ text: "Você gastou R$ 0,00 em bar." })]);
			const result = await runDueAgents(deps({ readApiKey: async () => "sk", createClient: () => client }));
			expect(result).toEqual({ ran: 1, created: 1, worded: 0, failed: 0 });
			const [alert] = await stores.agents.listAlerts({ agentId: agent.id });
			expect(alert).toMatchObject({
				kind: "custom",
				dedupeKey: "custom:2026-11-08",
				title: "Bar",
				body: "Você gastou R$ 0,00 em bar.",
				wordedByAi: true,
			});
			expect(requests[0]?.tools.map((t) => t.name)).toEqual(["get_month_summary"]);
			expect(requests[0]?.system.at(-1)?.text).toContain("Me avisa se eu gastar muito em bar.");
			expect((await stores.aiUsage.monthTotals("2026-11")).costMicroUsd).toBeGreaterThan(0);
			// Mesmo período: não roda outra vez.
			expect(
				await runDueAgents(deps({ readApiKey: async () => "sk", createClient: () => client })),
			).toMatchObject({ ran: 0 });
		});

		it("acima do limite mensal nem chama o modelo", async () => {
			await stores.agents.createCustom(custom);
			await stores.aiUsage.setMonthlyLimit(0);
			const { client, requests } = fakeClient([]);
			const result = await runDueAgents(deps({ readApiKey: async () => "sk", createClient: () => client }));
			expect(result.ran).toBe(0);
			expect(requests).toHaveLength(0);
		});

		it("SEM_AVISO marca como rodado sem gravar aviso", async () => {
			const agent = await stores.agents.createCustom(custom);
			const { client } = fakeClient([() => ({ text: "SEM_AVISO" })]);
			const result = await runDueAgents(deps({ readApiKey: async () => "sk", createClient: () => client }));
			expect(result).toEqual({ ran: 1, created: 0, worded: 0, failed: 0 });
			expect((await stores.agents.get(agent.id))?.lastRunAt).toEqual(NOW);
		});
	});

	it("a falha de um agente não impede os outros e ele tenta de novo na próxima passada", async () => {
		await seedBudgetNearLimit();
		await runDueAgents(deps());
		const vigia = await agentOf("vigia");
		await stores.agents.update(vigia.id, { enabled: true });
		const custom = await stores.agents.createCustom({
			name: "Outro",
			instructions: "Avise.",
			tools: ["get_month_summary"],
			frequency: "daily",
			runHour: 9,
			runDay: null,
		});
		const broken: Stores = {
			...stores,
			agents: {
				...stores.agents,
				addAlerts: async (id, drafts) => {
					if (id === vigia.id) throw new Error("banco caiu");
					return stores.agents.addAlerts(id, drafts);
				},
			},
		};
		const { client } = fakeClient([() => ({ text: "Aviso do outro." })]);
		const result = await runDueAgents(
			deps({ stores: broken, readApiKey: async () => "sk", createClient: () => client }),
		);
		expect(result).toEqual({ ran: 1, created: 1, worded: 0, failed: 1 });
		expect(logs.join("\n")).toContain("Vigia falhou: banco caiu");
		expect((await stores.agents.get(vigia.id))?.lastRunAt).toBeNull();
		expect((await stores.agents.get(custom.id))?.lastRunAt).toEqual(NOW);
	});
});
