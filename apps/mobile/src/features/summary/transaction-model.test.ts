import { describe, expect, it } from "vitest";
import {
	amountTone,
	categoryIcon,
	signedAmount,
	transactionBadge,
	transactionBrand,
	transactionIcon,
} from "./transaction-model.ts";

describe("transactionIcon", () => {
	it("despesa segue a categoria pelo slug", () => {
		const bySlug: Record<string, string> = {
			mercado: "mercado",
			delivery: "comida",
			transporte: "transporte",
			assinaturas: "assinatura",
			lazer: "lazer",
			moradia: "inicio",
			saude: "saude",
			transferencias: "transferir",
			investimentos: "investimento",
			outros: "etiqueta",
			salario: "salario",
			"fatura-cartao": "cartao",
		};
		for (const [slug, icon] of Object.entries(bySlug)) expect(transactionIcon("expense", slug)).toBe(icon);
	});

	it("categoria do dono cai nas palavras do nome, sem acento", () => {
		expect(transactionIcon("expense", "restaurante", "Restaurante")).toBe("comida");
		expect(transactionIcon("expense", "farmacia", "Farmácia")).toBe("saude");
		expect(transactionIcon("expense", "educacao", "Educação")).toBe("educacao");
		expect(transactionIcon("expense", "compras", "Compras online")).toBe("compras");
		expect(transactionIcon("expense", "viagem", "Viagens")).toBe("aviao");
		expect(transactionIcon("expense", "x", "Aluguel e condomínio")).toBe("inicio");
	});

	it("o slug do sistema vence o nome; sem nada conhecido, etiqueta", () => {
		expect(transactionIcon("expense", "mercado", "Restaurante")).toBe("mercado");
		expect(transactionIcon("expense", "pets", "Pets")).toBe("etiqueta");
		expect(transactionIcon("expense", undefined)).toBe("etiqueta");
		expect(categoryIcon(undefined, "Barbearia")).toBe("etiqueta");
	});

	it("os outros tipos têm ícone próprio, independente da categoria", () => {
		expect(transactionIcon("income", "mercado")).toBe("salario");
		expect(transactionIcon("transfer", undefined)).toBe("pix");
		expect(transactionIcon("card_payment", undefined)).toBe("cartao");
		expect(transactionIcon("refund", "delivery")).toBe("desfazer");
	});
});

describe("transactionBrand", () => {
	it("despesa e estorno de loja conhecida têm marca; os outros tipos não", () => {
		expect(transactionBrand({ kind: "expense", description: "DL*Spotify P48CE" })?.id).toBe("spotify");
		expect(transactionBrand({ kind: "refund", description: "MERCADOLIVRE*MERCADOLIVRE" })?.id).toBe(
			"mercadolivre",
		);
		expect(transactionBrand({ kind: "income", description: "Spotify" })).toBeNull();
		expect(transactionBrand({ kind: "transfer", description: "Uber" })).toBeNull();
		expect(transactionBrand({ kind: "expense", description: "Padaria do Zé" })).toBeNull();
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
		expect(transactionIcon("investment", undefined)).toBe("investimento");
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
