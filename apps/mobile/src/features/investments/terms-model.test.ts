import type { InvestmentPositionDto } from "@orbita/shared";
import { describe, expect, it } from "vitest";
import { HIDDEN_VALUE } from "../../lib/format.ts";
import {
	bankLine,
	buildTermsBody,
	expectedView,
	informedTerms,
	isInformed,
	isInvestmentsKey,
	missingChip,
	needsTerms,
	parseInvested,
	parseRateText,
	rateDraft,
	rateLabel,
	rateToText,
	startDateProblem,
	startLabel,
	termsRows,
} from "./terms-model.ts";

type P = Partial<InvestmentPositionDto>;
const TODAY = "2026-11-10";

const empty: P = {
	termsApplicable: true,
	terms: { rate: null, invested: null, startDate: null },
	missing: ["rate", "invested", "startDate"],
	nameHint: null,
};

const full: P = {
	termsApplicable: true,
	terms: {
		rate: { kind: "CDI_PERCENT", bps: 10200, source: "USER" },
		invested: { cents: 100_000, source: "USER" },
		startDate: { date: "2026-11-03", source: "BANK" },
	},
	missing: [],
};

describe("taxa", () => {
	it("bps em texto de campo e rótulo, sem float", () => {
		expect(rateToText(10200)).toBe("102");
		expect(rateToText(1350)).toBe("13,5");
		expect(rateToText(1325)).toBe("13,25");
		expect(rateToText(605)).toBe("6,05");
		expect(rateToText(1)).toBe("0,01");
		expect(rateLabel("CDI_PERCENT", 10200)).toBe("102% do CDI");
		expect(rateLabel("PREFIXED", 1350)).toBe("13,5% a.a.");
		expect(rateLabel("IPCA_PLUS", 620)).toBe("IPCA + 6,2%");
	});

	it("campo decimal vira bps: vírgula ou ponto, até duas casas", () => {
		expect(parseRateText("102", "CDI_PERCENT")).toEqual({ bps: 10200 });
		expect(parseRateText("13,5", "PREFIXED")).toEqual({ bps: 1350 });
		expect(parseRateText("13.25%", "PREFIXED")).toEqual({ bps: 1325 });
		expect(parseRateText("6,05", "IPCA_PLUS")).toEqual({ bps: 605 });
		expect(parseRateText("0,1", "IPCA_PLUS")).toEqual({ bps: 10 });
		expect(parseRateText("0", "IPCA_PLUS")).toEqual({ bps: 0 });
		// 1,15 * 100 daria 114,99999 com float
		expect(parseRateText("1,15", "CDI_PERCENT")).toEqual({ bps: 115 });
	});

	it("rejeita vazio, lixo, casas demais e fora do limite do contrato", () => {
		expect(parseRateText("", "CDI_PERCENT")).toEqual({ error: "Informe a taxa" });
		expect(parseRateText("abc", "CDI_PERCENT")).toEqual({ error: "Taxa inválida" });
		expect(parseRateText("1,234", "CDI_PERCENT")).toEqual({ error: "Taxa inválida" });
		expect(parseRateText("1.000,5", "CDI_PERCENT")).toEqual({ error: "Taxa inválida" });
		expect("error" in parseRateText("0", "CDI_PERCENT")).toBe(true);
		expect("error" in parseRateText("1001", "CDI_PERCENT")).toBe(true);
		expect("error" in parseRateText("101", "PREFIXED")).toBe(true);
	});

	it("o rascunho vem da taxa efetiva, depois da sugestão do nome, depois vazio", () => {
		expect(rateDraft(full)).toEqual({ kind: "CDI_PERCENT", text: "102", hint: null });
		const hint = { kind: "PREFIXED", bps: 1350, matched: "13,5% a.a.", source: "NAME_HINT" } as const;
		expect(rateDraft({ ...empty, nameHint: hint })).toEqual({ kind: "PREFIXED", text: "13,5", hint });
		expect(rateDraft(empty)).toEqual({ kind: "CDI_PERCENT", text: "", hint: null });
	});
});

describe("dinheiro e data", () => {
	it("valor aplicado em centavos por texto", () => {
		expect(parseInvested("1.000,00")).toBe(100_000);
		expect(parseInvested("R$ 1,15")).toBe(115);
		expect(parseInvested("0,10")).toBe(10);
		expect(parseInvested("0")).toBeNull();
		expect(parseInvested("")).toBeNull();
		expect(parseInvested("x")).toBeNull();
	});

	it("data não futura", () => {
		expect(startDateProblem("2026-11-10", TODAY)).toBeNull();
		expect(startDateProblem("2026-11-11", TODAY)).toBe("Data futura");
		expect(startDateProblem(null, TODAY)).toBe("Data inválida");
	});

	it("data curta e com ano quando não é o de hoje", () => {
		expect(startLabel("2026-11-03", TODAY)).toBe("3 de nov");
		expect(startLabel("2025-03-10", TODAY)).toBe("10 de mar de 2025");
	});
});

describe("sinal de completar", () => {
	it("só quando se aplica e falta algo; servidor antigo nunca", () => {
		expect(needsTerms(empty as InvestmentPositionDto)).toBe(true);
		expect(needsTerms(full as InvestmentPositionDto)).toBe(false);
		expect(needsTerms({} as InvestmentPositionDto)).toBe(false);
		expect(needsTerms({ termsApplicable: false, missing: ["rate"] } as InvestmentPositionDto)).toBe(false);
	});

	it("chip curto", () => {
		expect(missingChip(2)).toBe("2 a completar");
		expect(missingChip(0)).toBeNull();
		expect(missingChip(undefined)).toBeNull();
	});
});

describe("cartão Condições", () => {
	it("falta tudo: três linhas sem valor", () => {
		const rows = termsRows(empty as InvestmentPositionDto, false, TODAY);
		expect(rows?.map((r) => [r.label, r.value, r.user])).toEqual([
			["Taxa", null, false],
			["Aplicado", null, false],
			["Desde", null, false],
		]);
		expect(rows?.[0]?.a11y).toBe("Taxa, informar");
	});

	it("completo: valores e marcador 'você' só no que o dono informou", () => {
		const rows = termsRows(full as InvestmentPositionDto, false, TODAY);
		expect(rows?.map((r) => [r.value, r.user])).toEqual([
			["102% do CDI", true],
			["R$ 1.000,00", true],
			["3 de nov", false],
		]);
		expect(rows?.[0]?.a11y).toBe("Taxa, 102% do CDI, informado por você");
	});

	it("olho fechado esconde o aplicado e deixa a taxa", () => {
		const rows = termsRows(full as InvestmentPositionDto, true, TODAY);
		expect(rows?.[0]?.value).toBe("102% do CDI");
		expect(rows?.[1]?.value).toBe(HIDDEN_VALUE);
	});

	it("servidor antigo ou não aplicável: sem cartão", () => {
		expect(termsRows({} as InvestmentPositionDto, false, TODAY)).toBeNull();
		expect(
			termsRows({ termsApplicable: false, terms: empty.terms } as InvestmentPositionDto, false, TODAY),
		).toBeNull();
	});

	it("'Banco: X' só quando o banco informa algo diferente do efetivo", () => {
		const p = {
			terms: {
				rate: { kind: "CDI_PERCENT", bps: 10200, source: "USER" },
				invested: { cents: 100_000, source: "BANK" },
				startDate: null,
				bank: { rate: { kind: "CDI_PERCENT", bps: 10000 }, invested: 100_000, startDate: null },
			},
		} as InvestmentPositionDto;
		expect(bankLine(p, "rate", false)).toBe("Banco: 100% do CDI");
		expect(bankLine(p, "invested", false)).toBeNull();
		expect(bankLine(p, "startDate", false)).toBeNull();
		expect(bankLine({ terms: full.terms } as InvestmentPositionDto, "rate", false)).toBeNull();
	});

	it("isInformed olha a origem", () => {
		expect(isInformed(full as InvestmentPositionDto, "rate")).toBe(true);
		expect(isInformed(full as InvestmentPositionDto, "startDate")).toBe(false);
	});
});

describe("corpo do PUT", () => {
	it("preserva o que o dono informou e ignora o do banco", () => {
		expect(informedTerms(full as InvestmentPositionDto)).toEqual({
			rateKind: "CDI_PERCENT",
			rateBps: 10200,
			investedCents: 100_000,
		});
	});

	it("alterar um campo manda o conjunto completo", () => {
		const body = buildTermsBody(full as InvestmentPositionDto, { field: "startDate", value: "2026-10-01" });
		expect(body).toEqual({
			rateKind: "CDI_PERCENT",
			rateBps: 10200,
			investedCents: 100_000,
			startDate: "2026-10-01",
		});
		const rate = buildTermsBody(full as InvestmentPositionDto, {
			field: "rate",
			value: { kind: "PREFIXED", bps: 1350 },
		});
		expect(rate).toEqual({ rateKind: "PREFIXED", rateBps: 1350, investedCents: 100_000 });
	});

	it("limpar tira só aquele campo; o último limpo vira {}", () => {
		expect(buildTermsBody(full as InvestmentPositionDto, { field: "rate", value: null })).toEqual({
			investedCents: 100_000,
		});
		const only = {
			terms: { rate: { kind: "IPCA_PLUS", bps: 620, source: "USER" }, invested: null, startDate: null },
		};
		expect(buildTermsBody(only as InvestmentPositionDto, { field: "rate", value: null })).toEqual({});
	});

	it("primeira informação numa posição vazia", () => {
		expect(buildTermsBody(empty as InvestmentPositionDto, { field: "invested", value: 50_000 })).toEqual({
			investedCents: 50_000,
		});
	});
});

describe("rendimento esperado", () => {
	const expected = {
		grossCents: 105_000,
		yieldCents: 5000,
		netYieldCents: 4200,
		iofCents: null,
		irCents: 800,
		asOf: "2026-11-07",
		businessDays: 20,
		reason: null,
		warnings: [],
	};

	it("esperado, diferença com sinal e líquido; 'até' pequeno", () => {
		const v = expectedView(
			{ termsApplicable: true, expected, expectedUnavailable: null, gapCents: 1230 },
			false,
		);
		expect(v).toMatchObject({ kind: "ready", until: "até 7 de nov", approx: false });
		if (v.kind !== "ready") throw new Error("esperava ready");
		expect(v.lines.map((l) => [l.label, l.value, l.tone])).toEqual([
			["Esperado", "R$ 1.050,00", "primary"],
			["Diferença", "+R$ 12,30", "primary"],
			["Líquido est.", "+R$ 42,00", "secondary"],
		]);
	});

	it("diferença negativa em aviso; sem líquido não há linha; warnings viram 'aprox.'", () => {
		const v = expectedView(
			{
				termsApplicable: true,
				expected: { ...expected, netYieldCents: null, warnings: ["um único aporte"] },
				expectedUnavailable: null,
				gapCents: -300,
			},
			false,
		);
		if (v.kind !== "ready") throw new Error("esperava ready");
		expect(v.approx).toBe(true);
		expect(v.lines.map((l) => l.label)).toEqual(["Esperado", "Diferença"]);
		expect(v.lines[1]).toMatchObject({ value: "−R$ 3,00", tone: "warning" });
	});

	it("olho fechado esconde esperado, diferença e líquido", () => {
		const v = expectedView(
			{ termsApplicable: true, expected, expectedUnavailable: null, gapCents: 1230 },
			true,
		);
		if (v.kind !== "ready") throw new Error("esperava ready");
		expect(v.lines.every((l) => l.value === HIDDEN_VALUE)).toBe(true);
	});

	it("sem saldo do banco: só o esperado", () => {
		const v = expectedView(
			{ termsApplicable: true, expected, expectedUnavailable: null, gapCents: null },
			false,
		);
		if (v.kind !== "ready") throw new Error("esperava ready");
		expect(v.lines.map((l) => l.label)).toEqual(["Esperado", "Líquido est."]);
	});

	it("indisponível vira expressão curta", () => {
		const base = { termsApplicable: true, expected: null, gapCents: null } as const;
		expect(
			expectedView({ ...base, expectedUnavailable: { code: "ipca_unsupported", message: "x" } }, false),
		).toEqual({ kind: "unavailable", text: "IPCA ainda não" });
		expect(
			expectedView({ ...base, expectedUnavailable: { code: "cdi_unavailable", message: "x" } }, false),
		).toEqual({ kind: "unavailable", text: "CDI indisponível" });
	});

	it("falta dado, não aplicável ou servidor antigo: nada", () => {
		expect(expectedView({ termsApplicable: true, expected: null, expectedUnavailable: null }, false)).toEqual(
			{
				kind: "none",
			},
		);
		expect(expectedView({ termsApplicable: false, expected: expected }, false)).toEqual({ kind: "none" });
		expect(expectedView({}, false)).toEqual({ kind: "none" });
	});
});

describe("consultas a invalidar", () => {
	it("lista, detalhe e evolução do mesmo servidor", () => {
		const url = "https://api.exemplo.test";
		expect(isInvestmentsKey([url, "investments"], url)).toBe(true);
		expect(isInvestmentsKey([url, "investment", "abc"], url)).toBe(true);
		expect(isInvestmentsKey([url, "investments-evolution", "1y"], url)).toBe(true);
		expect(isInvestmentsKey([url, "goals"], url)).toBe(false);
		expect(isInvestmentsKey(["outro", "investments"], url)).toBe(false);
	});
});
