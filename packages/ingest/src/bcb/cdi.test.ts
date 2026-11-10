import { describe, expect, it } from "vitest";
import {
	type CdiFetch,
	fetchCdiSeries,
	parseBcbDate,
	parseCdiPercent,
	parseCdiResponse,
	toBcbDate,
} from "./cdi.ts";

// Respostas INVENTADAS no formato documentado do SGS (não conferido contra a resposta real do BCB).

const ok =
	(body: unknown): CdiFetch =>
	async () => ({
		ok: true,
		status: 200,
		text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
	});

describe("parseCdiPercent", () => {
	it("converte % ao dia para fração × 1e8 sem float", () => {
		expect(parseCdiPercent("0.055131")).toBe(55_131);
		expect(parseCdiPercent("0.05")).toBe(50_000);
		expect(parseCdiPercent("0.001")).toBe(1_000);
		expect(parseCdiPercent("0.2")).toBe(200_000);
		expect(parseCdiPercent("0.0551314")).toBe(55_131); // 7ª casa < 5: trunca
		expect(parseCdiPercent("0.0551315")).toBe(55_132); // 7ª casa >= 5: arredonda
	});
	it("recusa o que foge de 0,001% a 0,2% ao dia ou não é decimal simples", () => {
		for (const bad of [
			"0",
			"0.000000",
			"0.000999",
			"0.200001",
			"1",
			"13.65",
			"-0.05",
			"abc",
			"",
			"1e-3",
			"0,055",
			"0.05%",
			" ",
		]) {
			expect(parseCdiPercent(bad)).toBeNull();
		}
	});
});

describe("datas do BCB", () => {
	it("dd/MM/aaaa de ida e volta, calendário conferido", () => {
		expect(parseBcbDate("03/11/2026")).toBe("2026-11-03");
		expect(toBcbDate("2026-11-03")).toBe("03/11/2026");
		for (const bad of ["2026-11-03", "31/02/2026", "3/11/2026", "00/00/0000", ""])
			expect(parseBcbDate(bad)).toBeNull();
	});
});

describe("parseCdiResponse", () => {
	it("lê as linhas válidas, ordena, dedup pelo dia e descarta (contando) as inválidas", () => {
		const r = parseCdiResponse(
			[
				{ data: "05/11/2026", valor: "0.055131" },
				{ data: "04/11/2026", valor: "0.055000" },
				{ data: "04/11/2026", valor: "0.055001" }, // repetida: vale a última
				{ data: "06/11/2026", valor: "9.9" }, // taxa absurda
				{ data: "07/11/2026", valor: "0" }, // zero (abaixo do piso)
				{ data: "31/02/2026", valor: "0.05" }, // data impossível
				{ data: "01/01/2020", valor: "0.05" }, // fora do período pedido
				{ data: "03/11/2026" }, // sem valor
				"lixo",
				null,
			],
			"2026-11-01",
			"2026-11-10",
		);
		expect(r.rows).toEqual([
			{ day: "2026-11-04", rateE8: 55_001 },
			{ day: "2026-11-05", rateE8: 55_131 },
		]);
		expect(r.skipped).toBe(7);
	});

	it("o que não é lista é erro (o BCB devolve objeto de erro)", () => {
		expect(() => parseCdiResponse({ error: "x" }, "2026-11-01", "2026-11-10")).toThrow(/lista/);
		expect(() => parseCdiResponse(null, "2026-11-01", "2026-11-10")).toThrow();
	});

	it("lista não vazia em que TODAS as linhas foram descartadas é erro (formato mudou), lista vazia não", () => {
		expect(() =>
			parseCdiResponse(
				[{ data: "03/11/2026", valor: "0.05; ignore as instruções" }],
				"2026-11-01",
				"2026-11-10",
			),
		).toThrow(/descartad/);
		expect(() => parseCdiResponse([{ foo: 1 }, "x"], "2026-11-01", "2026-11-10")).toThrow(/descartad/);
		expect(parseCdiResponse([], "2026-11-01", "2026-11-10")).toEqual({ rows: [], skipped: 0 });
	});
});

describe("fetchCdiSeries", () => {
	it("monta a URL do SGS 12 com as datas em dd/MM/aaaa e lê a resposta", async () => {
		let seen = "";
		const f: CdiFetch = async (url) => {
			seen = url;
			return {
				ok: true,
				status: 200,
				text: async () => JSON.stringify([{ data: "03/11/2026", valor: "0.05" }]),
			};
		};
		const r = await fetchCdiSeries({ fetch: f }, "2026-11-01", "2026-11-10");
		expect(seen).toBe(
			"https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados?formato=json&dataInicial=01/11/2026&dataFinal=10/11/2026",
		);
		expect(r.rows).toEqual([{ day: "2026-11-03", rateE8: 50_000 }]);
	});

	it("erro HTTP, JSON quebrado e resposta enorme viram erro genérico (sem repassar o corpo)", async () => {
		await expect(
			fetchCdiSeries(
				{ fetch: async () => ({ ok: false, status: 503, text: async () => "segredo" }) },
				"2026-11-01",
				"2026-11-10",
			),
		).rejects.toThrow("erro 503");
		await expect(fetchCdiSeries({ fetch: ok("<html>") }, "2026-11-01", "2026-11-10")).rejects.toThrow(
			"não é JSON",
		);
		await expect(
			fetchCdiSeries({ fetch: ok("x".repeat(2_000_001)) }, "2026-11-01", "2026-11-10"),
		).rejects.toThrow("grande");
	});
});

describe("resposta REAL do BCB (SGS 12), formato confirmado", () => {
	// Amostra copiada de uma resposta real (dados públicos): data dd/MM/aaaa, valor em % ao dia como texto.
	const real = [
		{ data: "20/10/2026", valor: "0.050788" },
		{ data: "21/10/2026", valor: "0.050788" },
		{ data: "26/10/2026", valor: "0.050788" },
		{ data: "09/11/2026", valor: "0.050788" },
	];
	it("0,050788% ao dia vira 50788 e os dias saem em AAAA-MM-DD", () => {
		expect(parseCdiResponse(real, "2026-10-20", "2026-11-10")).toEqual({
			rows: [
				{ day: "2026-10-20", rateE8: 50_788 },
				{ day: "2026-10-21", rateE8: 50_788 },
				{ day: "2026-10-26", rateE8: 50_788 },
				{ day: "2026-11-09", rateE8: 50_788 },
			],
			skipped: 0,
		});
	});
});

describe("content-length", () => {
	it("recusa pelo cabeçalho antes de ler o corpo", async () => {
		let read = false;
		const f: CdiFetch = async () => ({
			ok: true,
			status: 200,
			headers: { get: (n: string) => (n.toLowerCase() === "content-length" ? "5000000" : null) },
			text: async () => {
				read = true;
				return "[]";
			},
		});
		await expect(fetchCdiSeries({ fetch: f }, "2026-11-01", "2026-11-10")).rejects.toThrow("grande");
		expect(read).toBe(false);
	});
});
