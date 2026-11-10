import { describe, expect, it } from "vitest";
import { addDays } from "./dates.ts";
import {
	type CdiDay,
	expectedYield,
	FIXED_SCALE,
	iofPercent,
	irRateHundredths,
	netOfTaxes,
	powFixed,
	rootFixed,
} from "./investment-expected.ts";

// Tudo fictício. Os valores de referência foram calculados à parte com aritmética decimal de 80 dígitos (Python
// `decimal`), não com o próprio engine.

/** `n` dias úteis (segunda a sexta, sem feriados) a partir de `start` (que deve ser dia útil), todos com a mesma taxa. */
function weekdays(start: string, n: number, rateE8: number): CdiDay[] {
	const out: CdiDay[] = [];
	let day = start;
	while (out.length < n) {
		const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
		if (dow !== 0 && dow !== 6) out.push({ day, rateE8 });
		day = addDays(day, 1);
	}
	return out;
}
const lastDay = (s: CdiDay[]) => (s[s.length - 1] as CdiDay).day;
const next = (s: CdiDay[]) => addDays(lastDay(s), 1);

describe("ponto fixo", () => {
	it("a raiz 252 e a potência se desfazem", () => {
		const annual = FIXED_SCALE + (FIXED_SCALE * 13n) / 100n;
		const daily = rootFixed(annual, 252);
		const back = powFixed(daily, 252);
		// Diferença de no máximo alguns 1e-15 relativos.
		const diff = back > annual ? back - annual : annual - back;
		expect(diff < 10n ** 4n).toBe(true);
	});
});

describe("% do CDI", () => {
	it("100% do CDI com taxa diária constante por 252 dias = (1+taxa)^252 (referência calculada à parte)", () => {
		const series = weekdays("2025-01-06", 252, 50_000); // 0,05% ao dia
		const r = expectedYield({
			investedCents: 1_000_000,
			startDate: "2025-01-06",
			today: next(series),
			rate: { kind: "CDI_PERCENT", bps: 10_000 },
			cdi: series,
			productKind: "CDB",
		});
		if (!r.ok) throw new Error("esperava ok");
		// (1,0005)^252 = 1,13424645086… → 1.134.246 centavos.
		expect(r.grossCents).toBe(1_134_246);
		expect(r.yieldCents).toBe(134_246);
		expect(r.businessDays).toBe(252);
		expect(r.asOf).toBe(lastDay(series));
	});

	it("102% do CDI: o percentual multiplica a taxa DIÁRIA, não o total (referência calculada à parte)", () => {
		const series = weekdays("2026-10-05", 10, 55_131); // 0,055131% ao dia
		const r = expectedYield({
			investedCents: 500_000,
			startDate: "2026-10-05",
			today: next(series),
			rate: { kind: "CDI_PERCENT", bps: 10_200 },
			cdi: series,
			productKind: "CDB",
		});
		if (!r.ok) throw new Error("esperava ok");
		// (1 + 0,00055131 × 1,02)^10 = 1,00563761… → 502.819
		expect(r.grossCents).toBe(502_819);
		expect(r.yieldCents).toBe(2_819);
	});

	it("110% do CDI por 5 dias a 0,05% (referência calculada à parte)", () => {
		const series = weekdays("2026-10-05", 5, 50_000);
		const r = expectedYield({
			investedCents: 1_000_000,
			startDate: "2026-10-05",
			today: next(series),
			rate: { kind: "CDI_PERCENT", bps: 11_000 },
			cdi: series,
			productKind: null,
		});
		if (!r.ok) throw new Error("esperava ok");
		expect(r.grossCents).toBe(1_002_753);
	});

	it("só entram dias de startDate (inclusive) a hoje (exclusive); dias fora da janela são ignorados", () => {
		const series = weekdays("2026-09-28", 10, 50_000); // 28/09 a 09/10
		const r = expectedYield({
			investedCents: 1_000_000,
			startDate: "2026-10-01",
			today: "2026-10-08", // 01,02,05,06,07 entram (08 não)
			rate: { kind: "CDI_PERCENT", bps: 10_000 },
			cdi: series,
			productKind: "CDB",
		});
		if (!r.ok) throw new Error("esperava ok");
		expect(r.businessDays).toBe(5);
		expect(r.asOf).toBe("2026-10-07");
	});
});

describe("prefixado", () => {
	it("13% a.a. por 252 dias úteis = 13% exatos", () => {
		const series = weekdays("2025-01-06", 252, 50_000);
		const r = expectedYield({
			investedCents: 1_000_000,
			startDate: "2025-01-06",
			today: next(series),
			rate: { kind: "PREFIXED", bps: 1_300 },
			cdi: series,
			productKind: "CDB",
		});
		if (!r.ok) throw new Error("esperava ok");
		expect(r.grossCents).toBe(1_130_000);
	});

	it("13% a.a. por 126 dias úteis = 1,13^(126/252) e 13,5% por 63 dias (referências à parte)", () => {
		const a = weekdays("2025-01-06", 126, 50_000);
		const ra = expectedYield({
			investedCents: 1_000_000,
			startDate: "2025-01-06",
			today: next(a),
			rate: { kind: "PREFIXED", bps: 1_300 },
			cdi: a,
			productKind: "CDB",
		});
		if (!ra.ok) throw new Error("esperava ok");
		expect(ra.grossCents).toBe(1_063_015);
		const b = weekdays("2025-01-06", 63, 50_000);
		const rb = expectedYield({
			investedCents: 2_000_000,
			startDate: "2025-01-06",
			today: next(b),
			rate: { kind: "PREFIXED", bps: 1_350 },
			cdi: b,
			productKind: "CDB",
		});
		if (!rb.ok) throw new Error("esperava ok");
		expect(rb.grossCents).toBe(2_064_329);
	});

	it("dias úteis são os dias com CDI publicado: a taxa do CDI não muda o prefixado", () => {
		const low = weekdays("2026-06-01", 20, 10_000);
		const high = weekdays("2026-06-01", 20, 90_000);
		const run = (cdi: CdiDay[]) =>
			expectedYield({
				investedCents: 1_000_000,
				startDate: "2026-06-01",
				today: next(cdi),
				rate: { kind: "PREFIXED", bps: 1_000 },
				cdi,
				productKind: "CDB",
			});
		expect(run(low)).toEqual(run(high));
	});
});

describe("IPCA+ e série indisponível", () => {
	it("IPCA+ guarda a taxa mas não calcula: ipca_unsupported", () => {
		const series = weekdays("2026-06-01", 20, 50_000);
		expect(
			expectedYield({
				investedCents: 1_000_000,
				startDate: "2026-06-01",
				today: next(series),
				rate: { kind: "IPCA_PLUS", bps: 620 },
				cdi: series,
				productKind: "TREASURY",
			}),
		).toMatchObject({ ok: false, code: "ipca_unsupported" });
	});

	it("sem série, ou série que começa muito depois da aplicação: cdi_unavailable (nunca zero)", () => {
		const base = {
			investedCents: 1_000_000,
			startDate: "2026-01-05",
			today: "2026-11-10",
			rate: { kind: "CDI_PERCENT", bps: 10_000 },
			productKind: "CDB",
		} as const;
		expect(expectedYield({ ...base, cdi: [] })).toMatchObject({ ok: false, code: "cdi_unavailable" });
		expect(expectedYield({ ...base, cdi: weekdays("2026-06-01", 20, 50_000) })).toMatchObject({
			ok: false,
			code: "cdi_unavailable",
		});
	});

	it("aplicação de hoje: rendimento zero verdadeiro, com a série carregada", () => {
		const series = weekdays("2026-11-02", 5, 50_000);
		const r = expectedYield({
			investedCents: 1_000_000,
			startDate: "2026-11-10",
			today: "2026-11-10",
			rate: { kind: "CDI_PERCENT", bps: 10_000 },
			cdi: series,
			productKind: "CDB",
		});
		expect(r).toMatchObject({ ok: true, grossCents: 1_000_000, yieldCents: 0, businessDays: 0 });
	});

	it("rejeita entradas absurdas em vez de calcular", () => {
		const series = weekdays("2026-06-01", 5, 50_000);
		const base = {
			startDate: "2026-06-01",
			today: "2026-06-10",
			rate: { kind: "CDI_PERCENT", bps: 10_000 },
			cdi: series,
			productKind: "CDB",
		} as const;
		expect(() => expectedYield({ ...base, investedCents: 0 })).toThrow(RangeError);
		expect(() => expectedYield({ ...base, investedCents: 100.5 })).toThrow(RangeError);
		expect(() => expectedYield({ ...base, investedCents: 100, startDate: "2026-07-01" })).toThrow(RangeError);
	});
});

describe("buraco na série", () => {
	it("calcula até o último dia sem lacuna e avisa até quando vale", () => {
		const before = weekdays("2026-03-02", 10, 50_000); // 02 a 13/03
		const after = weekdays("2026-04-20", 5, 50_000); // depois de uma lacuna de 5 semanas
		const r = expectedYield({
			investedCents: 1_000_000,
			startDate: "2026-03-02",
			today: "2026-04-28",
			rate: { kind: "CDI_PERCENT", bps: 10_000 },
			cdi: [...after, ...before],
			productKind: "CDB",
		});
		if (!r.ok) throw new Error("esperava ok");
		expect(r.businessDays).toBe(10);
		expect(r.asOf).toBe("2026-03-13");
		expect(r.warnings.join(" ")).toContain("falha entre 13/03/2026 e 20/04/2026");
	});

	it("série atrasada (último CDI velho): avisa a data até a qual vale", () => {
		const series = weekdays("2026-10-01", 10, 50_000); // até 14/10
		const r = expectedYield({
			investedCents: 1_000_000,
			startDate: "2026-10-01",
			today: "2026-11-10",
			rate: { kind: "CDI_PERCENT", bps: 10_000 },
			cdi: series,
			productKind: "CDB",
		});
		if (!r.ok) throw new Error("esperava ok");
		expect(r.asOf).toBe("2026-10-14");
		expect(r.warnings.join(" ")).toContain("só chega a 14/10/2026");
	});

	it("feriado de um dia útil (lacuna de 4 dias corridos) não trunca: só avisa quantos dias úteis faltaram", () => {
		const a = weekdays("2026-03-30", 4, 50_000); // seg 30/03 a qui 02/04
		const b = weekdays("2026-04-06", 3, 50_000); // seg 06/04 (sexta-feira santa 03/04 sem taxa)
		const r = expectedYield({
			investedCents: 1_000_000,
			startDate: "2026-03-30",
			today: "2026-04-10",
			rate: { kind: "CDI_PERCENT", bps: 10_000 },
			cdi: [...a, ...b],
			productKind: "CDB",
		});
		if (!r.ok) throw new Error("esperava ok");
		expect(r.businessDays).toBe(7);
		expect(r.missingWeekdays).toBe(1);
		expect(r.warnings.join(" ")).toContain("1 dia útil sem CDI");
	});

	it("lacuna com dia útil faltando e mais de 4 dias corridos (Carnaval) trunca e avisa", () => {
		const a = weekdays("2026-02-09", 5, 50_000); // 09 a 13/02 (sexta)
		const b = weekdays("2026-02-18", 5, 50_000); // quarta-feira de cinzas
		const r = expectedYield({
			investedCents: 1_000_000,
			startDate: "2026-02-09",
			today: "2026-02-25",
			rate: { kind: "CDI_PERCENT", bps: 10_000 },
			cdi: [...a, ...b],
			productKind: "CDB",
		});
		if (!r.ok) throw new Error("esperava ok");
		expect(r.businessDays).toBe(5);
		expect(r.asOf).toBe("2026-02-13");
	});

	it("fim de semana comum não conta como dia útil faltando", () => {
		const s = weekdays("2026-10-05", 10, 50_000);
		const r = expectedYield({
			investedCents: 1_000_000,
			startDate: "2026-10-05",
			today: next(s),
			rate: { kind: "CDI_PERCENT", bps: 10_000 },
			cdi: s,
			productKind: "CDB",
		});
		if (!r.ok) throw new Error("esperava ok");
		expect(r.missingWeekdays).toBe(0);
	});
});

describe("cobertura do início da série", () => {
	const base = {
		investedCents: 1_000_000,
		rate: { kind: "CDI_PERCENT", bps: 10_000 },
		productKind: "CDB",
	} as const;

	it("tolera até 4 dias corridos entre a aplicação e o primeiro CDI, e avisa que o primeiro dia usado é posterior", () => {
		const s = weekdays("2026-10-06", 5, 50_000); // terça 06/10
		const r = expectedYield({ ...base, startDate: "2026-10-02", today: next(s), cdi: s });
		if (!r.ok) throw new Error("esperava ok");
		expect(r.warnings.join(" ")).toContain("primeiro CDI usado é 06/10/2026, depois do início (02/10/2026)");
	});

	it("5 dias ou mais depois da aplicação: cdi_unavailable", () => {
		const s = weekdays("2026-10-07", 5, 50_000);
		expect(expectedYield({ ...base, startDate: "2026-10-02", today: next(s), cdi: s })).toMatchObject({
			ok: false,
			code: "cdi_unavailable",
		});
	});

	it("aplicação recente mas série atrasada: cdi_unavailable, nunca rendimento zero", () => {
		const s = weekdays("2026-09-01", 10, 50_000); // acaba em 14/09
		expect(expectedYield({ ...base, startDate: "2026-11-09", today: "2026-11-12", cdi: s })).toMatchObject({
			ok: false,
			code: "cdi_unavailable",
		});
	});
});

describe("IR e IOF", () => {
	it("tabela do IOF: 96% no 1º dia, 3% no 29º, 0 a partir do 30º", () => {
		expect(iofPercent(0)).toBe(0);
		expect(iofPercent(1)).toBe(96);
		expect(iofPercent(10)).toBe(66);
		expect(iofPercent(15)).toBe(50);
		expect(iofPercent(20)).toBe(33);
		expect(iofPercent(29)).toBe(3);
		expect(iofPercent(30)).toBe(0);
		expect(iofPercent(400)).toBe(0);
		// A tabela desce em passos de 3 ou 4 pontos.
		for (let d = 1; d < 29; d++) expect(iofPercent(d) - iofPercent(d + 1)).toBeGreaterThanOrEqual(3);
	});

	it("faixas do IR por dias corridos: 22,5 / 20 / 17,5 / 15", () => {
		expect(irRateHundredths(180)).toBe(2250);
		expect(irRateHundredths(181)).toBe(2000);
		expect(irRateHundredths(360)).toBe(2000);
		expect(irRateHundredths(361)).toBe(1750);
		expect(irRateHundredths(720)).toBe(1750);
		expect(irRateHundredths(721)).toBe(1500);
	});

	it("CDB com 400 dias: 17,5% do rendimento; LCI/LCA/CRI/CRA isentos; tipo desconhecido = líquido null com motivo", () => {
		expect(netOfTaxes(100_000, 400, "CDB")).toEqual({
			netYieldCents: 82_500,
			netReason: null,
			iofCents: 0,
			irCents: 17_500,
		});
		for (const kind of ["LCI", "LCA", "CRI", "CRA"] as const) {
			expect(netOfTaxes(100_000, 400, kind)).toMatchObject({ netYieldCents: 100_000, irCents: 0 });
		}
		const unknown = netOfTaxes(100_000, 400, null);
		expect(unknown.netYieldCents).toBeNull();
		expect(unknown.netReason).toContain("desconhecido");
		expect(netOfTaxes(100_000, 400, "DEBENTURE").netYieldCents).toBeNull();
	});

	it("IOF nos primeiros 30 dias abate antes do IR: 10 dias, rendimento 1.000 = IOF 660, IR 22,5% de 340 = 77 (76,5 arredonda)", () => {
		expect(netOfTaxes(1_000, 10, "CDB")).toEqual({
			netYieldCents: 263,
			netReason: null,
			iofCents: 660,
			irCents: 77,
		});
	});

	it("rendimento zero ou negativo não paga imposto", () => {
		expect(netOfTaxes(0, 10, "CDB")).toMatchObject({ netYieldCents: 0, irCents: 0, iofCents: 0 });
		expect(netOfTaxes(-500, 10, "CDB")).toMatchObject({ netYieldCents: -500, irCents: 0 });
	});

	it("o esperado traz o líquido: 252 dias úteis (352 dias corridos) a 0,05%: IR de 20%", () => {
		const series = weekdays("2025-01-06", 252, 50_000);
		const r = expectedYield({
			investedCents: 1_000_000,
			startDate: "2025-01-06",
			today: next(series),
			rate: { kind: "CDI_PERCENT", bps: 10_000 },
			cdi: series,
			productKind: "CDB",
		});
		if (!r.ok) throw new Error("esperava ok");
		expect(r.calendarDays).toBeGreaterThan(180);
		expect(r.calendarDays).toBeLessThanOrEqual(360);
		// 134.246 × 20% = 26.849,2 → 26.849; líquido 107.397.
		expect(r).toMatchObject({ irCents: 26_849, iofCents: 0, netYieldCents: 107_397, netReason: null });
	});

	it("aplicação de 10 dias úteis com tipo desconhecido: bruto existe, líquido não", () => {
		const series = weekdays("2026-10-05", 10, 50_000);
		const r = expectedYield({
			investedCents: 1_000_000,
			startDate: "2026-10-05",
			today: next(series),
			rate: { kind: "CDI_PERCENT", bps: 10_000 },
			cdi: series,
			productKind: null,
		});
		if (!r.ok) throw new Error("esperava ok");
		expect(r.yieldCents).toBeGreaterThan(0);
		expect(r.netYieldCents).toBeNull();
		expect(r.netReason).not.toBeNull();
	});
});
