import { chartSeries } from "@orbita/tokens";
import { describe, expect, it } from "vitest";
import {
	barWeights,
	buildRequest,
	countLabel,
	deadlineMonthLabel,
	deadlineOf,
	deadlineOptions,
	formFromGoal,
	type GoalLike,
	goalCaption,
	goalColor,
	goalIcon,
	initialForm,
	isAffectedByGoals,
	monthTitle,
	nextChartSlot,
	previewMonthly,
	previewText,
	projectionLabel,
	selectableGoals,
	statusLabel,
	totalsCaption,
	validateForm,
} from "./goals-model.ts";

const goal = (over: Partial<GoalLike> = {}): GoalLike => ({
	id: "g1",
	name: "Viagem para o Chile",
	targetCents: 800000,
	deadline: "2027-07-31",
	accountId: null,
	icon: "plane",
	chartSlot: 0,
	savedCents: 210000,
	remainingCents: 590000,
	percent: 26,
	reached: false,
	monthsLeft: 8,
	monthlyNeededCents: 73750,
	projectedDate: "2027-02-15",
	status: "on_track",
	...over,
});

describe("textos", () => {
	it("situação em pt-BR", () => {
		expect(statusLabel("on_track")).toBe("No ritmo");
		expect(statusLabel("behind")).toBe("Atrasada");
		expect(statusLabel("reached")).toBe("Atingida");
		expect(statusLabel("no_deadline")).toBe("Sem prazo");
	});

	it("legenda do cartão: prazo e valor mensal em reais cheios", () => {
		expect(goalCaption(goal())).toBe("Até julho de 2027 · R$ 738 por mês");
		expect(goalCaption(goal({ monthlyNeededCents: 73700 }))).toBe("Até julho de 2027 · R$ 737 por mês");
		expect(goalCaption(goal({ reached: true, monthlyNeededCents: 0 }))).toBe("Até julho de 2027");
		expect(goalCaption(goal({ deadline: null, monthlyNeededCents: null }))).toBe("Sem prazo");
		expect(deadlineMonthLabel("2027-03-31")).toBe("março de 2027");
		expect(monthTitle("2027-07")).toBe("Julho de 2027");
	});

	it("totais e contagem no singular e no plural", () => {
		expect(countLabel(1)).toBe("1 meta");
		expect(countLabel(3)).toBe("3 metas");
		expect(totalsCaption("R$ 12.000,00", 3)).toBe("de R$ 12.000,00 somando as 3 metas");
		expect(totalsCaption("R$ 500,00", 1)).toBe("de R$ 500,00 somando a meta");
	});

	it("projeção: mês estimado, sem ritmo ou nada se já atingiu", () => {
		expect(projectionLabel(goal())).toBe("No ritmo de agora, termina em fevereiro de 2027.");
		expect(projectionLabel(goal({ projectedDate: null }))).toBe(
			"Guarde um valor para eu estimar quando termina.",
		);
		expect(projectionLabel(goal({ reached: true, status: "reached" }))).toBeNull();
	});
});

describe("aparência", () => {
	it("cor vem da paleta dos gráficos, com volta para a primeira", () => {
		expect(goalColor(0)).toBe(chartSeries[0]);
		expect(goalColor(9)).toBe(chartSeries[9]);
		expect(goalColor(42)).toBe(chartSeries[0]);
	});

	it("todo ícone da API tem desenho", () => {
		for (const icon of ["target", "plane", "shield", "monitor", "home", "car", "heart", "gift"] as const) {
			expect(goalIcon(icon)).toBeTruthy();
		}
		expect(goalIcon("plane")).toBe("aviao");
	});

	it("barra: limita de 0 a 100", () => {
		expect(barWeights(26)).toEqual({ done: 26, rest: 74 });
		expect(barWeights(-3)).toEqual({ done: 0, rest: 100 });
		expect(barWeights(140)).toEqual({ done: 100, rest: 0 });
	});

	it("cor inicial é a primeira que nenhuma meta usa", () => {
		expect(nextChartSlot([])).toBe(0);
		expect(nextChartSlot([0, 1, 3])).toBe(2);
		expect(nextChartSlot([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0])).toBe(1);
	});
});

describe("formulário", () => {
	it("nasce vazio, sem prazo, com a próxima cor", () => {
		expect(initialForm([0])).toEqual({
			name: "",
			targetCents: 0,
			deadlineMonth: null,
			icon: "target",
			chartSlot: 1,
			accountId: null,
		});
	});

	it("o prazo salvo é o último dia do mês escolhido", () => {
		expect(deadlineOf("2027-07")).toBe("2027-07-31");
		expect(deadlineOf("2028-02")).toBe("2028-02-29");
		expect(deadlineOf("2027-02")).toBe("2027-02-28");
	});

	it("edição devolve o mês do prazo", () => {
		expect(formFromGoal(goal())).toMatchObject({ deadlineMonth: "2027-07", name: "Viagem para o Chile" });
		expect(formFromGoal(goal({ deadline: null })).deadlineMonth).toBeNull();
	});

	it("opções de prazo: do mês corrente a 4 anos depois", () => {
		const options = deadlineOptions("2026-11");
		expect(options[0]).toBe("2026-11");
		expect(options[1]).toBe("2026-12");
		expect(options[2]).toBe("2027-01");
		expect(options).toHaveLength(49);
		expect(options[48]).toBe("2030-11");
	});

	it("valida nome, valor e ícone", () => {
		const ok = { ...initialForm(), name: "Viagem", targetCents: 800000 };
		expect(validateForm(ok)).toBeNull();
		expect(validateForm({ ...ok, name: "   " })).toBe("Dê um nome para a meta.");
		expect(validateForm({ ...ok, name: "x".repeat(61) })).toBe("O nome passa de 60 letras.");
		expect(validateForm({ ...ok, targetCents: 0 })).toBe("Informe quanto quer guardar.");
		expect(validateForm({ ...ok, targetCents: 2_147_483_648 })).toBe("O valor passa do limite aceito.");
	});

	it("monta o corpo de criar e de editar (centavos inteiros, nome sem espaços)", () => {
		const form = {
			...initialForm(),
			name: "  Notebook ",
			targetCents: 100000,
			deadlineMonth: "2027-01",
			icon: "monitor" as const,
			chartSlot: 3,
		};
		expect(buildRequest({ form, editingId: null })).toEqual({
			ok: true,
			request: {
				type: "create",
				body: {
					name: "Notebook",
					targetCents: 100000,
					deadline: "2027-01-31",
					accountId: null,
					icon: "monitor",
					chartSlot: 3,
				},
			},
		});
		const edit = buildRequest({ form: { ...form, deadlineMonth: null }, editingId: "g1" });
		expect(edit).toMatchObject({ ok: true, request: { type: "update", id: "g1", body: { deadline: null } } });
		expect(buildRequest({ form: initialForm(), editingId: null })).toEqual({
			ok: false,
			message: "Dê um nome para a meta.",
		});
	});
});

describe("prévia do valor mensal (mesma conta do engine)", () => {
	const today = "2026-11-08";
	it("divide o que falta pelos meses até o prazo, para cima", () => {
		expect(
			previewMonthly({ form: { targetCents: 800000, deadlineMonth: "2027-07" }, savedCents: 0, today }),
		).toEqual({ monthlyCents: 100000, monthsLeft: 8 });
		expect(
			previewMonthly({ form: { targetCents: 800000, deadlineMonth: "2027-07" }, savedCents: 210000, today }),
		).toEqual({ monthlyCents: 73750, monthsLeft: 8 });
	});

	it("sem valor ou sem prazo não há prévia", () => {
		expect(
			previewMonthly({ form: { targetCents: 0, deadlineMonth: "2027-07" }, savedCents: 0, today }),
		).toBeNull();
		expect(
			previewMonthly({ form: { targetCents: 100, deadlineMonth: null }, savedCents: 0, today }),
		).toBeNull();
	});

	it("mês corrente conta 1 mês; já guardou tudo, zero por mês", () => {
		expect(
			previewMonthly({ form: { targetCents: 5000, deadlineMonth: "2026-11" }, savedCents: 0, today }),
		).toEqual({ monthlyCents: 5000, monthsLeft: 1 });
		expect(
			previewMonthly({ form: { targetCents: 5000, deadlineMonth: "2027-01" }, savedCents: 9000, today }),
		).toEqual({ monthlyCents: 0, monthsLeft: 2 });
	});

	it("texto da prévia", () => {
		expect(previewText({ monthlyCents: 73700 }, true)).toBe("R$ 737 por mês");
		expect(previewText(null, true)).toBe("Sem prazo, sem valor por mês");
		expect(previewText(null, false)).toBe("Informe o valor e o prazo");
	});
});

describe("dados", () => {
	it("guardar recarrega metas e preferências do mesmo servidor", () => {
		expect(isAffectedByGoals(["https://x", "goals"], "https://x")).toBe(true);
		expect(isAffectedByGoals(["https://x", "goals", "g1"], "https://x")).toBe(true);
		expect(isAffectedByGoals(["https://x", "preferences"], "https://x")).toBe(true);
		expect(isAffectedByGoals(["https://x", "summary"], "https://x")).toBe(false);
		expect(isAffectedByGoals(["https://y", "goals"], "https://x")).toBe(false);
	});

	it("escolher a sobra só oferece metas ativas", () => {
		const list = [
			{ id: "a", archivedAt: null },
			{ id: "b", archivedAt: "2026-11-01T00:00:00Z" },
		];
		expect(selectableGoals(list).map((g) => g.id)).toEqual(["a"]);
	});
});
