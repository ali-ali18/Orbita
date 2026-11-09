import { describe, expect, it } from "vitest";
import { amountTone, signedAmount, transactionBadge, transactionIcon } from "./transaction-model.ts";

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

describe("investimento (aplicação)", () => {
	it("sai do saldo, mas não é gasto: valor negativo, cor neutra e ícone de gráfico", () => {
		expect(signedAmount({ kind: "investment", amountCents: 200000 })).toBe(-200000);
		expect(amountTone("investment")).toBe("secondary");
		expect(transactionIcon("investment", undefined)).toBe("grafico");
	});
});

describe("selo da linha", () => {
	it("'Pendente no banco' é outra coisa que 'Pendente' (Para revisar)", () => {
		expect(transactionBadge({ status: "confirmed" })).toBeUndefined();
		expect(transactionBadge({ status: "confirmed", bankPending: false })).toBeUndefined();
		expect(transactionBadge({ status: "confirmed", bankPending: true })).toBe("Pendente no banco");
		expect(transactionBadge({ status: "pending", bankPending: true })).toBe("Pendente");
		expect(transactionBadge({ status: "pending" })).toBe("Pendente");
	});
});
