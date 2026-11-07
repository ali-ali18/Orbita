import { describe, expect, it } from "vitest";
import { chooseConnectionLabel, labelFromAccounts, labelIsReplaceable } from "./connection-label.ts";
import type { PluggyAccount } from "./schemas.ts";

const acc = (over: Partial<PluggyAccount> & { id: string }): PluggyAccount => ({
	type: "BANK",
	name: "Conta",
	...over,
});

describe("labelFromAccounts", () => {
	it("usa marketingName ou name, contas BANK antes de CREDIT", () => {
		const accounts = [
			acc({ id: "c", type: "CREDIT", name: "Cartão", marketingName: "Mastercard Black" }),
			acc({ id: "b", name: "Conta Corrente", marketingName: null }),
		];
		expect(labelFromAccounts(accounts)).toBe("Conta Corrente, Mastercard Black");
	});

	it("tira repetidos (caixa e acento) e mostra +N", () => {
		const accounts = [
			acc({ id: "1", name: "Conta Inter" }),
			acc({ id: "2", name: "CONTA INTER" }),
			acc({ id: "3", name: "Poupança" }),
			acc({ id: "4", name: "Poupanca" }),
			acc({ id: "5", type: "CREDIT", name: "Visa" }),
			acc({ id: "6", type: "CREDIT", name: "Elo" }),
		];
		expect(labelFromAccounts(accounts)).toBe("Conta Inter, Poupança +2");
	});

	it("sanea controle e espaços, limita cada nome e o total", () => {
		const long = "Z".repeat(80);
		const label = labelFromAccounts([
			acc({ id: "1", name: "  Conta\n\tInter\u0000  " }),
			acc({ id: "2", name: long }),
			...Array.from({ length: 120 }, (_, i) => acc({ id: `x${i}`, name: `Outra ${i}` })),
		]);
		expect(label?.startsWith("Conta Inter, Zzz")).toBe(true);
		expect(label).toMatch(/ \+120$/);
		expect(label?.length).toBeLessThanOrEqual(60);
		expect(label).not.toMatch(/\p{Cc}/u);
	});

	it("ignora o que não é conta e devolve null sem nome", () => {
		expect(labelFromAccounts([])).toBeNull();
		expect(labelFromAccounts([acc({ id: "1", type: "INVESTMENT", name: "CDB" })])).toBeNull();
		expect(labelFromAccounts([acc({ id: "1", name: " \n ", marketingName: "" })])).toBeNull();
	});
});

describe("labelIsReplaceable", () => {
	it("troca vazio e o nome do conector (sem caixa/espaço/acento), nunca o do dono", () => {
		expect(labelIsReplaceable(null, "MeuPluggy", false)).toBe(true);
		expect(labelIsReplaceable("  ", "MeuPluggy", false)).toBe(true);
		expect(labelIsReplaceable("Meu Pluggy", "MeuPluggy", false)).toBe(true);
		expect(labelIsReplaceable("MeuPluggy", "MeuPluggy", true)).toBe(false);
		expect(labelIsReplaceable("Nubank", "MeuPluggy", false)).toBe(false);
		expect(labelIsReplaceable("MeuPluggy", null, false)).toBe(false);
	});
});

describe("chooseConnectionLabel", () => {
	const accounts = [acc({ id: "1", name: "Conta Inter" })];
	it("escolhe o nome, ou null quando nada muda", () => {
		const base = { connectorName: "MeuPluggy", editedByOwner: false, accounts };
		expect(chooseConnectionLabel({ ...base, current: "MeuPluggy" })).toBe("Conta Inter");
		expect(chooseConnectionLabel({ ...base, current: "Conta Inter" })).toBeNull();
		expect(chooseConnectionLabel({ ...base, current: "Meu nome" })).toBeNull();
		expect(chooseConnectionLabel({ ...base, current: "MeuPluggy", editedByOwner: true })).toBeNull();
		expect(chooseConnectionLabel({ ...base, current: "MeuPluggy", accounts: [] })).toBeNull();
	});
});
