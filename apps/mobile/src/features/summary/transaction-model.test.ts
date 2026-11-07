import { describe, expect, it } from "vitest";
import { amountTone, transactionIcon } from "./transaction-model.ts";

describe("transactionIcon", () => {
	it("despesa segue a categoria pelo slug", () => {
		expect(transactionIcon("expense", "mercado")).toBe("mercado");
		expect(transactionIcon("expense", "delivery")).toBe("comida");
		expect(transactionIcon("expense", "transporte")).toBe("transporte");
		expect(transactionIcon("expense", "assinaturas")).toBe("assinatura");
	});

	it("categoria desconhecida ou ausente cai em cartão", () => {
		expect(transactionIcon("expense", "lazer")).toBe("cartao");
		expect(transactionIcon("expense", undefined)).toBe("cartao");
	});

	it("os outros tipos têm ícone próprio, independente da categoria", () => {
		expect(transactionIcon("income", "mercado")).toBe("grafico");
		expect(transactionIcon("transfer", undefined)).toBe("pix");
		expect(transactionIcon("card_payment", undefined)).toBe("cartao");
		expect(transactionIcon("refund", "delivery")).toBe("desfazer");
	});
});

describe("amountTone", () => {
	it("o que entra é verde: receita, estorno e pagamento de fatura", () => {
		expect(amountTone("income")).toBe("positive");
		expect(amountTone("refund")).toBe("positive");
		expect(amountTone("card_payment")).toBe("positive");
	});

	it("a saída continua branca", () => {
		expect(amountTone("expense")).toBe("primary");
	});

	it("transferência entre contas próprias é neutra", () => {
		expect(amountTone("transfer")).toBe("secondary");
	});
});
