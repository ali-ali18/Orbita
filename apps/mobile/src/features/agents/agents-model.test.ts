import type { AgentDto } from "@orbita/shared";
import { agents as agentTokens } from "@orbita/tokens";
import { describe, expect, it } from "vitest";
import {
	activeCountLabel,
	checkDraft,
	DEFAULT_TOOLS,
	draftName,
	initialDraft,
	isAffectedByAgents,
	previewOf,
	scheduleLabel,
	settingOn,
	settingRows,
	settingValue,
	splitAgents,
	suggestName,
	toolsSummary,
	visibleAlerts,
	visualKey,
	whenLabel,
	withFrequency,
} from "./agents-model.ts";

const agent = (over: Partial<AgentDto> = {}) =>
	({
		id: "a1",
		builtinKey: "vigia",
		name: "Vigia",
		tagline: "Avisa quando um gasto foge do orçamento.",
		enabled: true,
		latestAlert: null,
		...over,
	}) as AgentDto;

describe("lista", () => {
	it("separa os ativos dos que faltam ativar e conta", () => {
		const list = [agent({ id: "1" }), agent({ id: "2", enabled: false }), agent({ id: "3" })];
		const { active, toActivate } = splitAgents(list);
		expect(active.map((a) => a.id)).toEqual(["1", "3"]);
		expect(toActivate.map((a) => a.id)).toEqual(["2"]);
		expect(activeCountLabel(1)).toBe("1 ativo");
		expect(activeCountLabel(3)).toBe("3 ativos");
	});
	it("a linha mostra o último aviso, ou o que o agente faz", () => {
		expect(previewOf(agent())).toBe("Avisa quando um gasto foge do orçamento.");
		expect(
			previewOf(
				agent({ latestAlert: { title: "Delivery chegou a 80% do orçamento" } as AgentDto["latestAlert"] }),
			),
		).toBe("Delivery chegou a 80% do orçamento");
	});
	it("cada agente tem uma cor de token; o do dono usa a de agente personalizado", () => {
		expect(visualKey(agent())).toBe("vigia");
		expect(visualKey(agent({ builtinKey: null }))).toBe("custom");
		for (const key of [
			"orbita",
			"vigia",
			"fechamento",
			"metas",
			"caca_assinatura",
			"cofrinho",
			"custom",
		] as const) {
			expect(agentTokens[key].color).toMatch(/^#[0-9A-F]{6}$/);
		}
	});
	it("a hora do aviso: Agora, a hora no mesmo dia, ou o dia", () => {
		const now = new Date("2026-11-08T12:30:00Z");
		expect(whenLabel("2026-11-08T12:29:40Z", now, "2026-11-08")).toBe("Agora");
		expect(whenLabel("2026-11-08T12:00:00Z", now, "2026-11-08")).toBe("09:00");
		expect(whenLabel("2026-11-01T11:00:00Z", now, "2026-11-08")).toBe("1 de nov");
		expect(whenLabel("lixo", now, "2026-11-08")).toBe("");
	});
});

describe("agenda", () => {
	it("escreve em português", () => {
		expect(scheduleLabel({ frequency: "daily", hour: 9, day: null })).toBe("todo dia, 9h");
		expect(scheduleLabel({ frequency: "weekly", hour: 9, day: 1 })).toBe("toda segunda, 9h");
		expect(scheduleLabel({ frequency: "weekly", hour: 10, day: 6 })).toBe("todo sábado, 10h");
		expect(scheduleLabel({ frequency: "monthly", hour: 8, day: 5 })).toBe("todo dia 5, 8h");
	});
	it("trocar a frequência dá um dia que existe nela", () => {
		const daily = { frequency: "daily", hour: 9, day: null } as const;
		expect(withFrequency(daily, "weekly")).toEqual({ frequency: "weekly", hour: 9, day: 1 });
		expect(withFrequency(daily, "monthly")).toEqual({ frequency: "monthly", hour: 9, day: 1 });
		expect(withFrequency({ frequency: "monthly", hour: 9, day: 5 }, "daily")).toEqual(daily);
		expect(withFrequency(daily, "daily")).toBe(daily);
	});
});

describe("escolhas", () => {
	it("o Vigia tem as linhas que o servidor entende, e a Órbita nenhuma", () => {
		expect(settingRows("vigia").map((r) => r.key)).toEqual([
			"unusualSpending",
			"unusualMinCents",
			"duplicateCharge",
			"duplicateWindowDays",
			"budgetThreshold",
		]);
		expect(settingRows("orbita")).toEqual([]);
		expect(settingRows("cofrinho").map((r) => r.kind)).toEqual(["toggle", "cents"]);
	});
	it("mostra o valor em reais cheios e o prazo em dias", () => {
		const rows = settingRows("vigia");
		const settings = {
			unusualSpending: true,
			unusualMinCents: 30000,
			duplicateWindowDays: 3,
			duplicateCharge: false,
		};
		expect(settingValue(rows[1] as never, settings)).toBe("R$ 300");
		expect(settingValue(rows[3] as never, settings)).toBe("3 dias");
		expect(settingOn(rows[0] as never, settings)).toBe(true);
		expect(settingOn(rows[2] as never, settings)).toBe(false);
		expect(settingValue(rows[0] as never, settings)).toBeUndefined();
	});
});

describe("avisos", () => {
	it("esconde os dispensados", () => {
		const list = [{ status: "new" }, { status: "dismissed" }, { status: "seen" }] as const;
		expect(visibleAlerts(list).map((a) => a.status)).toEqual(["new", "seen"]);
	});
	it("recarrega agentes e avisos, e nada mais", () => {
		expect(isAffectedByAgents(["https://x", "agents"], "https://x")).toBe(true);
		expect(isAffectedByAgents(["https://x", "alerts", "new"], "https://x")).toBe(true);
		expect(isAffectedByAgents(["https://y", "agents"], "https://x")).toBe(false);
		expect(isAffectedByAgents(["https://x", "goals"], "https://x")).toBe(false);
	});
});

describe("criar agente", () => {
	it("sugere o nome pelas primeiras palavras", () => {
		expect(suggestName("Me avisa quando eu gastar mais de R$ 200 em bar")).toBe("Me avisa quando eu");
		expect(suggestName("  acompanha minha meta de viagem.  ")).toBe("Acompanha minha meta de");
		expect(suggestName("")).toBe("");
		expect(suggestName("x".repeat(80)).length).toBeLessThanOrEqual(40);
	});
	it("o nome escolhido vale mais que o sugerido", () => {
		const draft = { ...initialDraft("Avisa do bar"), name: "  Bar  " };
		expect(draftName(draft)).toBe("Bar");
		expect(draftName(initialDraft("Avisa do bar"))).toBe("Avisa do bar");
	});
	it("monta o pedido com leitura padrão e agenda diária", () => {
		const check = checkDraft(initialDraft("  Me avisa do bar  "));
		expect(check).toEqual({
			ok: true,
			body: {
				name: "Me avisa do bar",
				instructions: "Me avisa do bar",
				tools: [...DEFAULT_TOOLS],
				schedule: { frequency: "daily", hour: 9, day: null },
			},
		});
	});
	it("recusa frase vazia e sem nada para ler", () => {
		expect(checkDraft(initialDraft("   "))).toEqual({
			ok: false,
			message: "Diga em uma frase o que o agente deve fazer.",
		});
		expect(checkDraft({ ...initialDraft("Oi"), tools: [] })).toMatchObject({ ok: false });
	});
	it("resume o que o agente lê", () => {
		expect(toolsSummary(["get_month_summary"])).toBe("Resumo do mês");
		expect(toolsSummary(["get_month_summary", "list_catalog"])).toBe(
			"Resumo do mês e Contas, cartões e categorias",
		);
		expect(toolsSummary(["get_month_summary", "search_transactions", "goals_status", "list_catalog"])).toBe(
			"Resumo do mês, Lançamentos e mais 2",
		);
	});
});
