import { describe, expect, it } from "vitest";
import { datasetsForFormat, exportParams, filenameFrom, periodRange, toggleDataset } from "./export-model.ts";

describe("período", () => {
	it("este mês vai do dia 1 ao último dia", () => {
		expect(periodRange("month", "2026-11-15")).toEqual({
			ok: true,
			range: { from: "2026-11-01", to: "2026-11-30" },
		});
		expect(periodRange("month", "2028-02-10")).toEqual({
			ok: true,
			range: { from: "2028-02-01", to: "2028-02-29" },
		});
		expect(periodRange("month", "2026-12-31")).toEqual({
			ok: true,
			range: { from: "2026-12-01", to: "2026-12-31" },
		});
	});
	it("este ano e tudo", () => {
		expect(periodRange("year", "2026-11-15")).toEqual({
			ok: true,
			range: { from: "2026-01-01", to: "2026-12-31" },
		});
		expect(periodRange("all", "2026-11-15")).toEqual({ ok: true, range: {} });
	});
	it("datas escolhidas: lê DD/MM/AAAA e confere a ordem", () => {
		expect(periodRange("custom", "2026-11-15", { from: "01/10/2026", to: "31102026" })).toEqual({
			ok: true,
			range: { from: "2026-10-01", to: "2026-10-31" },
		});
		expect(periodRange("custom", "2026-11-15", { from: "01/10/2026", to: "" })).toEqual({
			ok: false,
			message: "Digite as duas datas no formato DD/MM/AAAA.",
		});
		expect(periodRange("custom", "2026-11-15", { from: "31/02/2026", to: "01/03/2026" }).ok).toBe(false);
		expect(periodRange("custom", "2026-11-15", { from: "02/10/2026", to: "01/10/2026" })).toEqual({
			ok: false,
			message: "A data inicial vem antes da final.",
		});
	});
});

describe("o que entra", () => {
	it("no CSV, tocar escolhe só aquele tipo de dado", () => {
		expect(toggleDataset("csv", ["transactions"], "categories")).toEqual(["categories"]);
	});
	it("no JSON, liga e desliga na ordem fixa, sempre com ao menos um", () => {
		expect(toggleDataset("json", ["transactions"], "subscriptions")).toEqual([
			"transactions",
			"subscriptions",
		]);
		expect(toggleDataset("json", ["transactions", "accounts"], "categories")).toEqual([
			"transactions",
			"categories",
			"accounts",
		]);
		expect(toggleDataset("json", ["transactions", "accounts"], "transactions")).toEqual(["accounts"]);
		expect(toggleDataset("json", ["accounts"], "accounts")).toEqual(["accounts"]);
	});
	it("trocar para CSV com vários marcados mantém só o primeiro", () => {
		expect(datasetsForFormat("csv", ["categories", "subscriptions"])).toEqual(["categories"]);
		expect(datasetsForFormat("json", ["categories", "subscriptions"])).toEqual([
			"categories",
			"subscriptions",
		]);
	});
});

describe("pedido", () => {
	it("manda o período só com lançamentos", () => {
		const range = { from: "2026-11-01", to: "2026-11-30" } as const;
		expect(exportParams({ format: "csv", include: ["transactions"], range })).toEqual({
			format: "csv",
			include: "transactions",
			from: "2026-11-01",
			to: "2026-11-30",
		});
		expect(exportParams({ format: "json", include: ["categories", "accounts"], range })).toEqual({
			format: "json",
			include: "categories,accounts",
		});
		expect(exportParams({ format: "json", include: ["transactions"], range: {} })).toEqual({
			format: "json",
			include: "transactions",
		});
	});
});

describe("nome do arquivo", () => {
	it("usa o do servidor quando é seguro e cai num nome simples senão", () => {
		expect(filenameFrom('attachment; filename="orbita-2026-11-15.json"', "x.json")).toBe(
			"orbita-2026-11-15.json",
		);
		expect(filenameFrom('attachment; filename="../../etc/passwd"', "orbita.json")).toBe("orbita.json");
		expect(filenameFrom(null, "orbita.csv")).toBe("orbita.csv");
	});
});
