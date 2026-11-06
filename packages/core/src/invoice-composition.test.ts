import { describe, expect, it } from "vitest";
import { type InvoiceLine, invoiceComposition } from "./invoice-composition.ts";

const line = (id: string, kind: InvoiceLine["kind"], amountCents: number, installmentGroupId?: string) => ({
	id,
	kind,
	amountCents,
	...(installmentGroupId ? { installmentGroupId } : {}),
});

describe("invoiceComposition", () => {
	it("fatura vazia é tudo zero", () => {
		expect(invoiceComposition([])).toEqual({
			purchasesCents: 0,
			installmentsCents: 0,
			recurringCents: 0,
			refundsCents: 0,
			totalCents: 0,
		});
	});

	it("separa compras, parcelas e recorrências; estorno subtrai", () => {
		const result = invoiceComposition(
			[
				line("a", "expense", 10_000),
				line("b", "expense", 5_000, "g1"),
				line("c", "expense", 3_000),
				line("d", "refund", 2_500),
			],
			{ recurringTransactionIds: new Set(["c"]) },
		);
		expect(result).toEqual({
			purchasesCents: 10_000,
			installmentsCents: 5_000,
			recurringCents: 3_000,
			refundsCents: 2_500,
			totalCents: 15_500,
		});
	});

	it("pagamento de fatura, transferência e receita ficam de fora", () => {
		const result = invoiceComposition([
			line("a", "expense", 1_000),
			line("p", "card_payment", 50_000),
			line("t", "transfer", 9_000),
			line("i", "income", 7_000),
		]);
		expect(result.totalCents).toBe(1_000);
		expect(result.refundsCents).toBe(0);
	});

	it("estorno maior que as compras deixa a fatura com crédito (total negativo)", () => {
		expect(invoiceComposition([line("a", "expense", 1_000), line("r", "refund", 1_500)]).totalCents).toBe(
			-500,
		);
	});

	it("parcela que também é recorrente conta só como parcela", () => {
		const result = invoiceComposition([line("a", "expense", 1_000, "g")], {
			recurringTransactionIds: new Set(["a"]),
		});
		expect(result).toMatchObject({ installmentsCents: 1_000, recurringCents: 0 });
	});

	it("valor inválido é erro", () => {
		expect(() => invoiceComposition([line("a", "expense", 0)])).toThrow(RangeError);
		expect(() => invoiceComposition([line("a", "expense", 1.5)])).toThrow(RangeError);
	});
});
