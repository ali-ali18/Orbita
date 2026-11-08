import { describe, expect, it } from "vitest";
import { defaultAccountLabel, selectableAccounts, toggleApp } from "./preferences-model.ts";

const accounts = [
	{ id: "a1", name: "Nubank", archivedAt: null },
	{ id: "a2", name: "Antiga", archivedAt: "2026-01-01T00:00:00Z" },
	{ id: "a3", name: "Inter", archivedAt: null },
];

describe("conta padrão", () => {
	it("só contas ativas podem ser escolhidas", () => {
		expect(selectableAccounts(accounts).map((a) => a.id)).toEqual(["a1", "a3"]);
	});
	it("mostra o nome, ou Nenhuma quando não há preferência, a conta sumiu ou foi arquivada", () => {
		expect(defaultAccountLabel(accounts, "a3")).toBe("Inter");
		expect(defaultAccountLabel(accounts, null)).toBe("Nenhuma");
		expect(defaultAccountLabel(accounts, "a2")).toBe("Nenhuma");
		expect(defaultAccountLabel(accounts, "fantasma")).toBe("Nenhuma");
	});
});

describe("apps de banco", () => {
	it("liga e desliga mantendo a ordem fixa", () => {
		expect(toggleApp([], "inter")).toEqual(["inter"]);
		expect(toggleApp(["inter"], "nubank")).toEqual(["nubank", "inter"]);
		expect(toggleApp(["nubank", "inter"], "nubank")).toEqual(["inter"]);
	});
});
