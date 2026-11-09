import { describe, expect, it } from "vitest";
import {
	cleanNotificationText,
	isSensitiveNotification,
	NOTIFICATION_BANK_PACKAGES,
	NOTIFICATION_BATCH_MAX,
	NOTIFICATION_TEXT_MAX,
	notificationAppOfPackage,
	notificationBatchBody,
} from "./notification-capture.ts";
import { NOTIFICATION_APPS } from "./preferences-api.ts";

describe("pacotes de banco", () => {
	it("todo app da lista tem ao menos um pacote, e cada pacote pertence a um app só", () => {
		const seen = new Set<string>();
		for (const app of NOTIFICATION_APPS) {
			expect(NOTIFICATION_BANK_PACKAGES[app].length).toBeGreaterThan(0);
			for (const pkg of NOTIFICATION_BANK_PACKAGES[app]) {
				expect(seen.has(pkg)).toBe(false);
				seen.add(pkg);
				expect(notificationAppOfPackage(pkg)).toBe(app);
			}
		}
	});

	it("pacote fora da lista não é de banco (inclusive parecido)", () => {
		for (const pkg of ["com.whatsapp", "com.nu.production.fake", "com.nu", "", "COM.NU.PRODUCTION"]) {
			expect(notificationAppOfPackage(pkg)).toBeNull();
		}
	});
});

describe("isSensitiveNotification", () => {
	it("pega código, token, senha e afins, com ou sem acento e em qualquer caixa", () => {
		for (const text of [
			"Seu código de verificação é 482913",
			"CODIGO: 123456",
			"Use o token 998877 para continuar",
			"Sua senha temporária é 4821",
			"Não compartilhe com ninguém",
			"Código de autenticação",
			"OTP 123456",
			"Confirmação: CVV 123",
			"G-123456",
			"123456",
		]) {
			expect(isSensitiveNotification(text), text).toBe(true);
		}
		expect(isSensitiveNotification("Compra aprovada", "Seu código é 123456")).toBe(true);
	});

	it("deixa passar compra, Pix e fatura (números de cartão e valores não são código)", () => {
		for (const text of [
			"Compra de R$ 23,45 APROVADA em LOJA EXEMPLO para o cartão com final 4821",
			"Compra aprovada: R$ 18,70 em LOJA TESTE no cartão final 7390",
			"Compra aprovada no cartão final 5512, R$ 12,34, SERVICO EXEMPLO",
			"Você pagou R$ 42,10 a EMPRESA EXEMPLO",
			"Você recebeu um Pix de R$ 6.604,00 de FULANO",
			"Pagamento da fatura de R$ 830,10 realizado",
		]) {
			expect(isSensitiveNotification(text), text).toBe(false);
		}
	});
});

describe("limpeza e esquema do lote", () => {
	it("tira controle e espaço sobrando e corta no tamanho", () => {
		expect(cleanNotificationText("  a\u0000b\n\n c‮ ", 50)).toBe("a b c");
		expect(cleanNotificationText("x".repeat(500), 10)).toHaveLength(10);
	});

	it("o servidor corta o texto grande em vez de recusar o lote (a fila do aparelho não trava)", () => {
		const parsed = notificationBatchBody.parse({
			items: [{ package: "com.nu.production", text: "y".repeat(5000), postedAt: 1_762_700_000_000 }],
		});
		expect(parsed.items[0]?.text).toHaveLength(NOTIFICATION_TEXT_MAX);
		expect(parsed.items[0]?.title).toBe("");
	});

	it("recusa lote vazio, grande demais e campo extra de tipo errado", () => {
		expect(notificationBatchBody.safeParse({ items: [] }).success).toBe(false);
		const one = { package: "com.nu.production", text: "t", postedAt: 1_762_700_000_000 };
		expect(
			notificationBatchBody.safeParse({ items: Array(NOTIFICATION_BATCH_MAX + 1).fill(one) }).success,
		).toBe(false);
		expect(notificationBatchBody.safeParse({ items: [{ ...one, postedAt: "ontem" }] }).success).toBe(false);
		expect(notificationBatchBody.safeParse({ items: [{ ...one, postedAt: 0 }] }).success).toBe(false);
	});
});
