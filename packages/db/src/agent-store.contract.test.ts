import { BUILTIN_AGENT_KEYS, BUILTIN_AGENTS } from "@orbita/shared";
import { beforeEach, describe, expect, it } from "vitest";
import type { BuiltinAgentSeed } from "./agent-store.ts";
import { contractSuites, seedBasics } from "./contract-harness.ts";
import type { Stores } from "./stores.ts";

const seeds: BuiltinAgentSeed[] = BUILTIN_AGENT_KEYS.map((key) => {
	const info = BUILTIN_AGENTS[key];
	return {
		builtinKey: key,
		name: info.name,
		enabled: info.defaultEnabled,
		frequency: info.defaultSchedule.frequency,
		runHour: info.defaultSchedule.hour,
		runDay: info.defaultSchedule.day,
		settings: info.defaultSettings,
	};
});

const custom = {
	name: "  Fim de semana  ",
	instructions: "Me avisa quando eu gastar mais de R$ 200 em bar.",
	tools: ["search_transactions", "get_budget_status", "search_transactions"],
	frequency: "weekly" as const,
	runHour: 10,
	runDay: 0,
};

describe.each(contractSuites())("AgentStore (%s)", (_name, make) => {
	let stores: Stores;
	beforeEach(async () => {
		stores = await make();
	});

	it("cria os agentes da casa uma vez só, na ordem do catálogo, sem sobrescrever o que o dono mudou", async () => {
		await stores.agents.ensureBuiltins(seeds);
		const first = await stores.agents.list();
		expect(first.map((a) => a.builtinKey)).toEqual([...BUILTIN_AGENT_KEYS]);
		expect(first.find((a) => a.builtinKey === "orbita")).toMatchObject({ enabled: true, runDay: null });
		expect(first.find((a) => a.builtinKey === "vigia")).toMatchObject({
			enabled: false,
			frequency: "daily",
			runHour: 9,
			settings: BUILTIN_AGENTS.vigia.defaultSettings,
			model: null,
			lastRunAt: null,
		});

		const vigia = first.find((a) => a.builtinKey === "vigia");
		await stores.agents.update(vigia?.id ?? "", { enabled: true, settings: { unusualSpending: false } });
		await stores.agents.ensureBuiltins(seeds);
		const again = await stores.agents.list();
		expect(again).toHaveLength(BUILTIN_AGENT_KEYS.length);
		expect(again.find((a) => a.builtinKey === "vigia")).toMatchObject({
			enabled: true,
			settings: { unusualSpending: false },
		});
	});

	it("cria agente do dono ligado, normaliza e lista depois dos da casa", async () => {
		await stores.agents.ensureBuiltins(seeds);
		const agent = await stores.agents.createCustom(custom);
		expect(agent).toMatchObject({
			builtinKey: null,
			name: "Fim de semana",
			instructions: "Me avisa quando eu gastar mais de R$ 200 em bar.",
			tools: ["search_transactions", "get_budget_status"],
			enabled: true,
			frequency: "weekly",
			runHour: 10,
			runDay: 0,
			settings: {},
			model: null,
		});
		expect(await stores.agents.get(agent.id)).toEqual(agent);
		expect(await stores.agents.get("nada")).toBeNull();
		const list = await stores.agents.list();
		expect(list.at(-1)?.id).toBe(agent.id);
	});

	it("rejeita nome, instruções, ferramentas e agenda inválidos", async () => {
		await expect(stores.agents.createCustom({ ...custom, name: "  " })).rejects.toMatchObject({
			code: "invalid",
			message: "Informe o nome do agente.",
		});
		await expect(stores.agents.createCustom({ ...custom, name: "x".repeat(41) })).rejects.toMatchObject({
			code: "invalid",
		});
		await expect(stores.agents.createCustom({ ...custom, instructions: "" })).rejects.toMatchObject({
			code: "invalid",
		});
		await expect(stores.agents.createCustom({ ...custom, tools: [] })).rejects.toMatchObject({
			code: "invalid",
			message: "Escolha ao menos uma coisa para o agente ler.",
		});
		await expect(
			stores.agents.createCustom({ ...custom, frequency: "daily", runDay: 3 }),
		).rejects.toMatchObject({ code: "invalid", message: "Agenda diária não tem dia." });
		await expect(stores.agents.createCustom({ ...custom, runDay: 7 })).rejects.toMatchObject({
			code: "invalid",
		});
		await expect(
			stores.agents.createCustom({ ...custom, frequency: "monthly", runDay: 29 }),
		).rejects.toMatchObject({ code: "invalid", message: "O dia do mês vai de 1 a 28." });
		await expect(stores.agents.createCustom({ ...custom, runHour: 24 })).rejects.toMatchObject({
			code: "invalid",
		});
	});

	it("atualiza campos e agenda; só o agente do dono muda nome, instruções e ferramentas", async () => {
		await stores.agents.ensureBuiltins(seeds);
		const house = (await stores.agents.list()).find((a) => a.builtinKey === "fechamento");
		const mine = await stores.agents.createCustom(custom);

		const updated = await stores.agents.update(house?.id ?? "", {
			model: "claude-haiku-5-5",
			runHour: 7,
		});
		expect(updated).toMatchObject({ model: "claude-haiku-5-5", runHour: 7, frequency: "monthly", runDay: 1 });
		expect((await stores.agents.update(updated.id, { model: null })).model).toBeNull();
		await expect(stores.agents.update(updated.id, { name: "Outro" })).rejects.toMatchObject({
			code: "invalid",
		});
		await expect(stores.agents.update(updated.id, { tools: ["list_catalog"] })).rejects.toMatchObject({
			code: "invalid",
		});

		const renamed = await stores.agents.update(mine.id, {
			name: "Bar",
			instructions: "Avisa do bar.",
			tools: ["list_catalog"],
			frequency: "daily",
		});
		expect(renamed).toMatchObject({
			name: "Bar",
			instructions: "Avisa do bar.",
			tools: ["list_catalog"],
			frequency: "daily",
			runDay: null,
		});
		// Trocar a frequência sem dia, para uma que precisa de dia, é recusado.
		await expect(stores.agents.update(mine.id, { frequency: "monthly" })).rejects.toMatchObject({
			code: "invalid",
		});
		await expect(stores.agents.update("nada", { enabled: true })).rejects.toMatchObject({
			code: "not_found",
		});
	});

	it("só apaga agente do dono e leva os avisos dele junto", async () => {
		await stores.agents.ensureBuiltins(seeds);
		const house = (await stores.agents.list())[1];
		await expect(stores.agents.deleteCustom(house?.id ?? "")).rejects.toMatchObject({ code: "invalid" });
		const mine = await stores.agents.createCustom(custom);
		await stores.agents.addAlerts(mine.id, [
			{ kind: "custom", dedupeKey: "custom:2026-11-08", title: "Oi", body: "Texto" },
		]);
		expect(await stores.agents.deleteCustom(mine.id)).toBe(true);
		expect(await stores.agents.deleteCustom(mine.id)).toBe(false);
		expect(await stores.agents.listAlerts()).toEqual([]);
	});

	it("anota a última execução", async () => {
		const mine = await stores.agents.createCustom(custom);
		const at = new Date("2026-11-08T11:00:00Z");
		await stores.agents.markRun(mine.id, at);
		expect((await stores.agents.get(mine.id))?.lastRunAt).toEqual(at);
		await expect(stores.agents.markRun("nada", at)).rejects.toMatchObject({ code: "not_found" });
	});

	it("não duplica avisos do mesmo achado e devolve só os novos", async () => {
		const mine = await stores.agents.createCustom(custom);
		const { checking } = await seedBasics(stores);
		const tx = await stores.transactions.create({
			kind: "expense",
			amountCents: 4690,
			date: "2026-11-05",
			description: "IFOOD",
			accountId: checking.id,
		});
		const first = await stores.agents.addAlerts(mine.id, [
			{
				kind: "duplicate_charge",
				dedupeKey: "dup:a:b",
				title: "  Cobrança repetida ",
				body: "IFOOD cobrou R$ 46,90 duas vezes.",
				data: { amountCents: 4690 },
				transactionId: tx.id,
			},
			{ kind: "custom", dedupeKey: "x", title: "Outro", body: "Texto" },
			{ kind: "custom", dedupeKey: "x", title: "Repetido no lote", body: "Texto" },
		]);
		expect(first.map((a) => a.dedupeKey)).toEqual(["dup:a:b", "x"]);
		expect(first[0]).toMatchObject({
			agentId: mine.id,
			title: "Cobrança repetida",
			status: "new",
			wordedByAi: false,
			data: { amountCents: 4690 },
			transactionId: tx.id,
			proposalId: null,
			seenAt: null,
			dismissedAt: null,
		});
		const second = await stores.agents.addAlerts(mine.id, [
			{ kind: "duplicate_charge", dedupeKey: "dup:a:b", title: "De novo", body: "Texto" },
			{ kind: "custom", dedupeKey: "y", title: "Novo", body: "Texto" },
		]);
		expect(second.map((a) => a.dedupeKey)).toEqual(["y"]);
		expect(await stores.agents.listAlerts()).toHaveLength(3);

		// Um achado dispensado não volta quando o agente roda de novo.
		await stores.agents.setAlertStatus(first[1]?.id ?? "", "dismissed");
		expect(
			await stores.agents.addAlerts(mine.id, [{ kind: "custom", dedupeKey: "x", title: "T", body: "B" }]),
		).toEqual([]);
		expect((await stores.agents.getAlert(first[1]?.id ?? ""))?.status).toBe("dismissed");
	});

	it("grava o aviso já escrito pela IA (agente do dono)", async () => {
		const mine = await stores.agents.createCustom(custom);
		const [alert] = await stores.agents.addAlerts(mine.id, [
			{ kind: "custom", dedupeKey: "ia", title: "T", body: "Escrito pela IA", wordedByAi: true },
		]);
		expect(alert).toMatchObject({ wordedByAi: true, body: "Escrito pela IA" });
		expect((await stores.agents.getAlert(alert?.id ?? ""))?.wordedByAi).toBe(true);
	});

	it("valida o aviso e as referências", async () => {
		const mine = await stores.agents.createCustom(custom);
		const draft = { kind: "custom" as const, dedupeKey: "k", title: "T", body: "B" };
		await expect(stores.agents.addAlerts("nada", [draft])).rejects.toMatchObject({ code: "not_found" });
		await expect(stores.agents.addAlerts(mine.id, [{ ...draft, title: " " }])).rejects.toMatchObject({
			code: "invalid",
		});
		await expect(stores.agents.addAlerts(mine.id, [{ ...draft, dedupeKey: "" }])).rejects.toMatchObject({
			code: "invalid",
		});
		await expect(
			stores.agents.addAlerts(mine.id, [{ ...draft, transactionId: "fantasma" }]),
		).rejects.toMatchObject({ code: "bad_reference" });
	});

	it("lista avisos por situação e agente, do mais novo para o mais antigo, e conta os novos", async () => {
		await stores.agents.ensureBuiltins(seeds);
		const [a, b] = [
			await stores.agents.createCustom(custom),
			await stores.agents.createCustom({ ...custom, name: "Outro" }),
		];
		const one = await stores.agents.addAlerts(a.id, [
			{ kind: "custom", dedupeKey: "1", title: "1", body: "b" },
		]);
		const two = await stores.agents.addAlerts(a.id, [
			{ kind: "custom", dedupeKey: "2", title: "2", body: "b" },
		]);
		const three = await stores.agents.addAlerts(b.id, [
			{ kind: "custom", dedupeKey: "3", title: "3", body: "b" },
		]);
		expect((await stores.agents.listAlerts()).map((x) => x.dedupeKey)).toEqual(["3", "2", "1"]);
		expect((await stores.agents.listAlerts({ agentId: a.id })).map((x) => x.dedupeKey)).toEqual(["2", "1"]);
		expect((await stores.agents.listAlerts({ limit: 1 })).map((x) => x.dedupeKey)).toEqual(["3"]);

		await stores.agents.setAlertStatus(two[0]?.id ?? "", "seen");
		expect((await stores.agents.listAlerts({ status: "new" })).map((x) => x.dedupeKey)).toEqual(["3", "1"]);
		expect(await stores.agents.countNewByAgent()).toEqual({ [a.id]: 1, [b.id]: 1 });
		expect(one).toHaveLength(1);
		expect(three).toHaveLength(1);
	});

	it("marca como visto e dispensado sem regravar o carimbo", async () => {
		const mine = await stores.agents.createCustom(custom);
		const [alert] = await stores.agents.addAlerts(mine.id, [
			{ kind: "custom", dedupeKey: "1", title: "1", body: "b" },
		]);
		const id = alert?.id ?? "";
		const seen = await stores.agents.setAlertStatus(id, "seen");
		expect(seen).toMatchObject({ status: "seen", dismissedAt: null });
		expect(seen?.seenAt).toBeInstanceOf(Date);
		expect((await stores.agents.setAlertStatus(id, "seen"))?.seenAt).toEqual(seen?.seenAt);

		const dismissed = await stores.agents.setAlertStatus(id, "dismissed");
		expect(dismissed).toMatchObject({ status: "dismissed", seenAt: seen?.seenAt });
		expect(dismissed?.dismissedAt).toBeInstanceOf(Date);
		// Dispensado não volta a "visto".
		expect((await stores.agents.setAlertStatus(id, "seen"))?.status).toBe("dismissed");
		expect((await stores.agents.setAlertStatus(id, "dismissed"))?.dismissedAt).toEqual(
			dismissed?.dismissedAt,
		);
		expect(await stores.agents.setAlertStatus("nada", "seen")).toBeNull();
	});

	it("troca o texto do aviso (reescrito pela IA)", async () => {
		const mine = await stores.agents.createCustom(custom);
		const [alert] = await stores.agents.addAlerts(mine.id, [
			{ kind: "custom", dedupeKey: "1", title: "1", body: "modelo" },
		]);
		const worded = await stores.agents.setAlertBody(alert?.id ?? "", "  Texto melhor  ", true);
		expect(worded).toMatchObject({ body: "Texto melhor", wordedByAi: true });
		await expect(stores.agents.setAlertBody(alert?.id ?? "", " ", true)).rejects.toMatchObject({
			code: "invalid",
		});
		expect(await stores.agents.setAlertBody("nada", "x", true)).toBeNull();
	});

	it("liga uma conversa a um agente; agente que não existe é recusado", async () => {
		const mine = await stores.agents.createCustom(custom);
		const conversation = await stores.chat.createConversation("Oi", { agentId: mine.id });
		expect(conversation.agentId).toBe(mine.id);
		expect((await stores.chat.getConversation(conversation.id))?.agentId).toBe(mine.id);
		expect((await stores.chat.createConversation("Sem agente")).agentId).toBeNull();
		await expect(stores.chat.createConversation("X", { agentId: "fantasma" })).rejects.toMatchObject({
			code: "not_found",
		});
		// Apagar o agente não apaga a conversa: ela volta a ser da Órbita.
		await stores.agents.deleteCustom(mine.id);
		expect((await stores.chat.getConversation(conversation.id))?.agentId).toBeNull();
	});
});
