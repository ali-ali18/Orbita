import { defaultHomeLayout, HOME_WIDGET_IDS } from "@orbita/shared";
import { describe, expect, it } from "vitest";
import { setupFinance } from "../../test-support.ts";

describe("layout dos widgets do Início", () => {
	it("exige o token", async () => {
		const { call } = await setupFinance();
		expect((await call("GET", "/v1/home/layout", undefined, null)).status).toBe(401);
		expect((await call("PUT", "/v1/home/layout", { items: [] }, null)).status).toBe(401);
	});

	it("sem nada guardado, devolve o layout padrão enxuto", async () => {
		const { api } = await setupFinance();
		const res = await api.get("/v1/home/layout");
		expect(res.status).toBe(200);
		expect(res.body).toEqual({ items: defaultHomeLayout() });
	});

	it("guarda ordem, tamanho e visibilidade; widget omitido entra oculto no fim", async () => {
		const { api } = await setupFinance();
		const items = [
			{ id: "recent", size: "2x4", visible: true },
			{ id: "subscriptions", size: "4x4", visible: true },
			{ id: "balance", size: "2x2", visible: true },
		];
		const put = await api.put("/v1/home/layout", { items });
		expect(put.status).toBe(200);
		expect(put.body.items.slice(0, 3)).toEqual(items);
		expect(put.body.items).toHaveLength(HOME_WIDGET_IDS.length);
		expect(put.body.items.slice(3).every((i: { visible: boolean }) => !i.visible)).toBe(true);
		expect((await api.get("/v1/home/layout")).body).toEqual(put.body);
	});

	it("recusa id desconhecido, tamanho desconhecido, tamanho que o widget não tem, repetido e campo extra", async () => {
		const { api } = await setupFinance();
		const bad = [
			[{ id: "x", size: "2x2", visible: true }],
			[{ id: "hero", size: "9x9", visible: true }],
			[{ id: "report", size: "2x2", visible: true }],
			[
				{ id: "hero", size: "4x4", visible: true },
				{ id: "hero", size: "2x4", visible: true },
			],
			[{ id: "hero", size: "4x4", visible: true, cor: "azul" }],
		];
		for (const items of bad) {
			expect((await api.put("/v1/home/layout", { items })).status).toBe(400);
		}
		expect((await api.put("/v1/home/layout", {})).status).toBe(400);
		expect((await api.put("/v1/home/layout", { items: [], extra: 1 })).status).toBe(400);
		const res = await api.put("/v1/home/layout", { items: [{ id: "report", size: "2x2", visible: true }] });
		expect(res.body.error.message).toBe("Relatório do mês não tem o tamanho 2x2.");
		// Nada foi gravado.
		expect((await api.get("/v1/home/layout")).body).toEqual({ items: defaultHomeLayout() });
	});
});
