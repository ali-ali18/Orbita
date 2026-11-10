import { createMemoryStores } from "@orbita/db";
import type { CdiFetch } from "@orbita/ingest";
import { describe, expect, it } from "vitest";
import { updateCdiRates } from "./cdi.ts";

const NOW = new Date("2026-11-10T15:00:00Z");

function fakeFetch(rows: Array<{ data: string; valor: string }>) {
	const urls: string[] = [];
	const fetch: CdiFetch = async (url) => {
		urls.push(url);
		return { ok: true, status: 200, text: async () => JSON.stringify(rows) };
	};
	return { fetch, urls };
}

describe("updateCdiRates", () => {
	it("série vazia: carga de 5 anos até hoje", async () => {
		const stores = createMemoryStores();
		const { fetch, urls } = fakeFetch([
			{ data: "06/11/2026", valor: "0.055131" },
			{ data: "09/11/2026", valor: "0.055131" },
		]);
		const r = await updateCdiRates({ stores, fetch, now: () => NOW });
		expect(r).toMatchObject({ created: 2, updated: 0, to: "2026-11-10", from: "2021-11-11" });
		expect(urls[0]).toContain("dataInicial=11/11/2021&dataFinal=10/11/2026");
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
});
