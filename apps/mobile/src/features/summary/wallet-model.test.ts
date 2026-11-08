import { daysBetween } from "@orbita/core";
import { describe, expect, it } from "vitest";
import {
	bandLook,
	bandRight,
	dueLine,
	isLastBand,
	longDate,
	nextDueText,
	openLine,
	orderBands,
	type WalletInvoice,
} from "./wallet-model.ts";

const reais = (c: number) => `R$ ${(c / 100).toFixed(2)}`;
const invoice = (extra: Partial<WalletInvoice> = {}): WalletInvoice => ({
	closingDate: "2026-11-05",
	dueDate: "2026-11-12",
	status: "closed",
	paymentStatus: "unpaid",
	totalCents: 69_194,
	paidCents: 0,
	...extra,
});

describe("orderBands", () => {
	const card = (name: string, nextDueDate: string | null) => ({ card: { name }, nextDueDate });
	it("vencimento mais próximo primeiro, sem vencimento por último, empate pelo nome", () => {
		const out = orderBands([
			card("Nubank", "2026-11-20"),
			card("Zeta", null),
			card("Santander", "2026-11-13"),
			card("Inter", "2026-11-13"),
		]);
		expect(out.map((c) => c.card.name)).toEqual(["Inter", "Santander", "Nubank", "Zeta"]);
	});
});

describe("isLastBand", () => {
	it("só a última faixa da pilha (a de baixo) é a última", () => {
		expect([0, 1, 2].map((i) => isLastBand(i, 3))).toEqual([false, false, true]);
	});
	it("uma faixa só é a última; pilha vazia não tem nenhuma", () => {
		expect(isLastBand(0, 1)).toBe(true);
		expect(isLastBand(0, 0)).toBe(false);
	});
});

describe("bandLook", () => {
	it("cor da marca pelo banco, preto no amarelo e neutro sem banco conhecido", () => {
		expect(bandLook({ name: "Santander" })).toMatchObject({ band: "#EC0000", text: "#FFFFFF" });
		expect(bandLook({ name: "Mercado Pago" })).toMatchObject({ band: "#FFE600", text: "#111111" });
		expect(bandLook({ name: "Cartão Nubank" }).band).toBe("#820AD1");
		expect(bandLook({ name: "Banco Inter", bankCode: "00416968" }).band).toBe("#EA7100");
		expect(bandLook({ name: "Banco Desconhecido" })).toMatchObject({ band: "#3A3A3A", logo: null });
	});
});

describe("textos", () => {
	it("data longa, curta e próximo vencimento", () => {
		expect(longDate("2026-11-13")).toBe("13 de novembro");
		expect(nextDueText("2026-11-13")).toBe("Próximo vencimento: 13 de novembro");
		expect(nextDueText(null)).toBe("Nenhuma fatura a vencer");
		expect(bandRight({ last4: "3143" })).toBe("•••• 3143");
		expect(bandRight({ last4: null })).toBe("");
	});
	it("'Vence dd/mm R$ X' com paga, falta ou nada", () => {
		expect(dueLine(invoice({ paymentStatus: "paid", paidCents: 69_194 }), reais)).toBe(
			"Vence 12/11 R$ 691.94 · paga",
		);
		expect(dueLine(invoice({ paymentStatus: "partial", paidCents: 19_194 }), reais)).toBe(
			"Vence 12/11 R$ 691.94 · falta R$ 500.00",
		);
		expect(dueLine(invoice(), reais)).toBe("Vence 12/11 R$ 691.94");
	});
	it("'Fatura atual R$ Y · fecha em N dias'", () => {
		const open = invoice({
			status: "open",
			paymentStatus: "open",
			totalCents: 5150,
			closingDate: "2026-12-05",
		});
		expect(openLine(open, "2026-11-08", reais, daysBetween)).toBe("Fatura atual R$ 51.50 · fecha em 27 dias");
		expect(openLine({ ...open, closingDate: "2026-11-08" }, "2026-11-08", reais, daysBetween)).toBe(
			"Fatura atual R$ 51.50 · fecha hoje",
		);
	});
});
