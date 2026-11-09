import { defaultHomeLayout, HOME_WIDGET_IDS, type HomeLayout } from "@orbita/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { contractSuites } from "./contract-harness.ts";
import type { Stores } from "./stores.ts";

describe.each(contractSuites())("HomeLayoutStore (%s)", (_name, make) => {
	let stores: Stores;
	beforeEach(async () => {
		stores = await make();
	});

	it("sem registro devolve o layout padrão", async () => {
		expect(await stores.homeLayout.get()).toEqual(defaultHomeLayout());
	});

	it("grava ordem, tamanho e visibilidade e devolve o mesmo na leitura", async () => {
		const items: HomeLayout = [
			{ id: "recent", size: "2x4", visible: true },
			{ id: "limit", size: "2x2", visible: true },
			{ id: "balance", size: "4x4", visible: false },
		];
		const saved = await stores.homeLayout.set(items);
		// Os widgets que o dono não mencionou entram ocultos no fim, no tamanho padrão.
		expect(saved.slice(0, 2)).toEqual(items.slice(0, 2));
		expect(saved).toHaveLength(HOME_WIDGET_IDS.length);
		expect(saved.filter((i) => i.visible).map((i) => i.id)).toEqual(["recent", "limit"]);
		expect(await stores.homeLayout.get()).toEqual(saved);
	});

	it("regravar troca tudo, sem acumular", async () => {
		await stores.homeLayout.set([{ id: "report", size: "2x4", visible: true }]);
		const next = await stores.homeLayout.set([{ id: "hero", size: "2x4", visible: true }]);
		expect(next.filter((i) => i.visible)).toEqual([{ id: "hero", size: "2x4", visible: true }]);
		expect((await stores.homeLayout.get()).find((i) => i.id === "report")?.visible).toBe(false);
	});

	it("recusa id repetido e tamanho que o widget não aceita, sem gravar nada", async () => {
		await stores.homeLayout.set([{ id: "hero", size: "2x4", visible: true }]);
		await expect(
			stores.homeLayout.set([
				{ id: "hero", size: "4x4", visible: true },
				{ id: "hero", size: "4x4", visible: true },
			]),
		).rejects.toMatchObject({ code: "invalid", message: "Widget repetido." });
		await expect(stores.homeLayout.set([{ id: "report", size: "4x4", visible: true }])).rejects.toMatchObject(
			{
				code: "invalid",
			},
		);
		expect((await stores.homeLayout.get()).find((i) => i.id === "hero")?.size).toBe("2x4");
	});

	it("a leitura devolve cópia: mexer nela não muda o que está guardado", async () => {
		const first = await stores.homeLayout.get();
		(first[0] as { visible: boolean }).visible = false;
		expect(await stores.homeLayout.get()).toEqual(defaultHomeLayout());
	});
});
