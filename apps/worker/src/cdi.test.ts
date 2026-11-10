import { createMemoryStores } from "@orbita/db";
import type { CdiFetch } from "@orbita/ingest";
import { describe, expect, it } from "vitest";
import { CDI_BACKFILL_YEARS, CDI_JOB_OPTIONS, updateCdiRates } from "./cdi.ts";

const NOW = new Date("2026-11-10T15:00:00Z");

/** Dias úteis (seg a sex) de `from` a `to`, no formato do BCB, com a mesma taxa. */
function bcbWeekdays(from: string, to: string) {
	const out: Array<{ data: string; valor: string }> = [];
	for (
		let t = new Date(`${from}T12:00:00Z`).getTime();
		t <= new Date(`${to}T12:00:00Z`).getTime();
		t += 86_400_000
	) {
		const d = new Date(t);
		if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
		const iso = d.toISOString().slice(0, 10);
		out.push({ data: `${iso.slice(8)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`, valor: "0.050788" });
	}
	return out;
}

function fakeFetch(rows: Array<{ data: string; valor: string }>) {
	const urls: string[] = [];
	const fetch: CdiFetch = async (url) => {
		urls.push(url);
		return { ok: true, status: 200, text: async () => JSON.stringify(rows) };
	};
	return { fetch, urls };
}

describe("updateCdiRates", () => {
	it("série vazia: carga de 8 anos até hoje (a API do BCB recusa 10 anos ou mais)", async () => {
		const stores = createMemoryStores();
		const { fetch, urls } = fakeFetch([
			{ data: "06/11/2026", valor: "0.055131" },
			{ data: "09/11/2026", valor: "0.055131" },
		]);
		const r = await updateCdiRates({ stores, fetch, now: () => NOW });
		expect(r).toMatchObject({ created: 2, updated: 0, to: "2026-11-10", from: "2018-11-12" });
		expect(urls[0]).toContain("dataInicial=12/11/2018&dataFinal=10/11/2026");
		expect((await stores.cdiRates.list()).map((x) => x.day)).toEqual(["2026-11-06", "2026-11-09"]);
	});

	it("idempotente: rodar de novo não cria nada; com série relê só a janela recente e aplica correção", async () => {
		const stores = createMemoryStores();
		const first = fakeFetch([{ data: "06/11/2026", valor: "0.055131" }]);
		await updateCdiRates({ stores, fetch: first.fetch, now: () => NOW });
		const again = fakeFetch([
			{ data: "06/11/2026", valor: "0.055131" },
			{ data: "09/11/2026", valor: "0.055200" },
		]);
		const r = await updateCdiRates({ stores, fetch: again.fetch, now: () => NOW });
		expect(r).toMatchObject({ created: 1, updated: 0, from: "2026-10-22" });
		expect(again.urls[0]).toContain("dataInicial=22/10/2026");
		const fix = fakeFetch([{ data: "06/11/2026", valor: "0.055000" }]);
		expect(await updateCdiRates({ stores, fetch: fix.fetch, now: () => NOW })).toMatchObject({
			created: 0,
			updated: 1,
		});
		expect(await updateCdiRates({ stores, fetch: fix.fetch, now: () => NOW })).toMatchObject({
			created: 0,
			updated: 0,
		});
	});

	it("falha do Banco Central derruba o job sem gravar nada", async () => {
		const stores = createMemoryStores();
		const fetch: CdiFetch = async () => ({ ok: false, status: 500, text: async () => "" });
		await expect(updateCdiRates({ stores, fetch, now: () => NOW })).rejects.toThrow("erro 500");
		expect(await stores.cdiRates.list()).toEqual([]);
	});

	it("linhas absurdas são descartadas e contadas, não gravadas", async () => {
		const stores = createMemoryStores();
		const { fetch } = fakeFetch([
			{ data: "06/11/2026", valor: "0.055131" },
			{ data: "09/11/2026", valor: "55" },
		]);
		const r = await updateCdiRates({ stores, fetch, now: () => NOW });
		expect(r).toMatchObject({ created: 1, skipped: 1 });
	});

	it("repara buraco antigo da série gravada relendo a faixa do buraco", async () => {
		const stores = createMemoryStores();
		// Já há série até 06/11, mas com um buraco de 5 dias úteis em agosto (que a leitura recente não alcança).
		const all = bcbWeekdays("2026-07-27", "2026-11-06");
		const withHole = all.filter(
			(r) => !["10/08/2026", "11/08/2026", "12/08/2026", "13/08/2026", "14/08/2026"].includes(r.data),
		);
		await stores.cdiRates.upsertMany(
			withHole.map((r) => ({
				day: `${r.data.slice(6)}-${r.data.slice(3, 5)}-${r.data.slice(0, 2)}`,
				rateE8: 50_788,
			})),
		);
		const urls: string[] = [];
		const fetch: CdiFetch = async (url) => {
			urls.push(url);
			const from = /dataInicial=(\d\d)\/(\d\d)\/(\d{4})/.exec(url) as RegExpExecArray;
			const iso = `${from[3]}-${from[2]}-${from[1]}`;
			return { ok: true, status: 200, text: async () => JSON.stringify(bcbWeekdays(iso, "2026-11-10")) };
		};
		const r = await updateCdiRates({ stores, fetch, now: () => NOW });
		expect(urls).toHaveLength(2);
		expect(urls[1]).toContain("dataInicial=");
		expect(r.created).toBeGreaterThanOrEqual(5);
		const days = (await stores.cdiRates.list()).map((x) => x.day);
		for (const d of ["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14"])
			expect(days).toContain(d);
		// Rodar de novo não acha buraco: uma chamada só.
		urls.length = 0;
		await updateCdiRates({ stores, fetch, now: () => NOW });
		expect(urls).toHaveLength(1);
	});

	it("feriado comum (1 a 2 dias úteis sem taxa) não é tratado como buraco", async () => {
		const stores = createMemoryStores();
		const rows = bcbWeekdays("2026-07-27", "2026-11-06").filter(
			(r) => !["03/08/2026", "04/08/2026"].includes(r.data),
		);
		await stores.cdiRates.upsertMany(
			rows.map((r) => ({
				day: `${r.data.slice(6)}-${r.data.slice(3, 5)}-${r.data.slice(0, 2)}`,
				rateE8: 50_788,
			})),
		);
		const urls: string[] = [];
		const fetch: CdiFetch = async (url) => {
			urls.push(url);
			return {
				ok: true,
				status: 200,
				text: async () => JSON.stringify(bcbWeekdays("2026-10-26", "2026-11-10")),
			};
		};
		await updateCdiRates({ stores, fetch, now: () => NOW });
		expect(urls).toHaveLength(1);
	});
});

describe("configuração do job", () => {
	it("backfill de 8 anos e 3 tentativas com espera exponencial", () => {
		expect(CDI_BACKFILL_YEARS).toBe(8);
		expect(CDI_JOB_OPTIONS).toMatchObject({ attempts: 3, backoff: { type: "exponential" } });
	});
});
