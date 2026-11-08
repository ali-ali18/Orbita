import { describe, expect, it } from "vitest";
import { suggestSpendingSlug } from "./classify.ts";

describe("suggestSpendingSlug", () => {
	it("usa o nome do Pluggy quando ele já diz o consumo", () => {
		expect(suggestSpendingSlug({ sourceCategory: "Food and drinks" })).toBe("delivery");
		expect(suggestSpendingSlug({ sourceCategory: "Groceries › Supermarket" })).toBe("mercado");
	});

	it("num PIX, a descrição decide; sem palavra conhecida, fica sem categoria", () => {
		expect(
			suggestSpendingSlug({
				sourceCategory: "Transfers › Transfer - PIX",
				description: "Pix enviado - Netflix",
			}),
		).toBe("assinaturas");
		expect(
			suggestSpendingSlug({
				sourceCategory: "Transfers › Transfer - PIX",
				description: "Pix enviado - Rei Dos",
			}),
		).toBeNull();
	});

	it("Shopping não escolhe sozinho; o nome na descrição escolhe, e compra sem palavra fica sem categoria", () => {
		expect(
			suggestSpendingSlug({
				sourceCategory: "Shopping",
				description: "Pix enviado - iFood",
			}),
		).toBe("delivery");
		expect(
			suggestSpendingSlug({
				sourceCategory: "Online shopping",
				description: "Compra online",
			}),
		).toBeNull();
	});
});
