import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HOME_WIDGET_IDS } from "@orbita/shared";
import { describe, expect, it } from "vitest";
import { CARD_TABS } from "../../card/card-model.ts";
import { WIDGET_ROUTES } from "./widget-routes.ts";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "../../../app");

describe("rota de cada widget do Início", () => {
	it("todo widget tem rota", () => {
		for (const id of HOME_WIDGET_IDS) expect(WIDGET_ROUTES[id], id).toBeTruthy();
	});

	it("a rota existe como arquivo em src/app", () => {
		for (const id of HOME_WIDGET_IDS) {
			const path = (WIDGET_ROUTES[id].split("?")[0] ?? "").replace(/^\//, "");
			expect(existsSync(join(appDir, `${path}.tsx`)), `${id} -> ${path}`).toBe(true);
		}
	});

	it("a aba do cartão pedida existe", () => {
		const tabs = CARD_TABS.map((t) => t.id as string);
		for (const id of HOME_WIDGET_IDS) {
			const aba = new URLSearchParams(WIDGET_ROUTES[id].split("?")[1] ?? "").get("aba");
			if (aba) expect(tabs, id).toContain(aba);
		}
	});

	it("Saldo e Limite abrem /saldo e a aba Limites", () => {
		expect(WIDGET_ROUTES.balance).toBe("/saldo");
		expect(WIDGET_ROUTES.limit).toBe("/cartao?aba=limites");
	});
});
