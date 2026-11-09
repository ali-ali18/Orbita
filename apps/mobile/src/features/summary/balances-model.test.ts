import { describe, expect, it } from "vitest";
import { accountKindLabel, sortBalanceLines, withoutBalanceNotice } from "./balances-model.ts";

const line = (name: string, balanceCents: number | null) => ({
	name,
	balanceCents,
	hasBalance: balanceCents !== null,
});

describe("balances-model", () => {
	it("maior saldo primeiro e contas sem saldo no fim, por nome", () => {
		const sorted = sortBalanceLines([
			line("Santander", null),
			line("Nubank", 0),
			line("Mercado Pago", 20535),
			line("Inter", null),
		]);
		expect(sorted.map((l) => l.name)).toEqual(["Mercado Pago", "Nubank", "Inter", "Santander"]);
	});

	it("saldo negativo vem depois do zero", () => {
		expect(sortBalanceLines([line("A", -500), line("B", 0)]).map((l) => l.name)).toEqual(["B", "A"]);
	});

	it("aviso das contas sem saldo", () => {
		expect(withoutBalanceNotice(0)).toBeNull();
		expect(withoutBalanceNotice(1)).toBe("1 conta sem saldo do banco fica fora do total.");
		expect(withoutBalanceNotice(3)).toBe("3 contas sem saldo do banco ficam fora do total.");
	});

	it("rótulo do tipo", () => {
		expect(accountKindLabel("checking")).toBe("Conta corrente");
		expect(accountKindLabel("wallet")).toBe("Carteira");
	});
});
