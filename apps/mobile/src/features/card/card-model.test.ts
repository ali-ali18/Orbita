import { banks, chart, chartSeries } from "@orbita/tokens";
import { describe, expect, it } from "vitest";
import {
	activeGroups,
	bestPurchaseDay,
	type CardLike,
	cardColor,
	cardLabel,
	commitment,
	compositionBar,
	compositionRows,
	cycleLabel,
	defaultInvoiceMonth,
	filterInvoiceLines,
	type InstallmentGroupLike,
	installmentCard,
	invoiceDatesCaption,
	invoiceLineCaption,
	invoiceStatusTag,
	limitBar,
	limitsOverview,
	monthAbbrev,
	monthChipLabel,
	monthColumns,
	monthWindow,
	openInvoiceMonth,
	parseTab,
	paymentBadge,
	statusLabel,
	statusOfMonth,
	usageMonths,
	usagePercent,
	usedLimitCents,
	visibleInstallments,
} from "./card-model.ts";

// Fecha dia 31, vence dia 7: em 7/11 a fatura de novembro está fechada e a de dezembro aberta.
const santander: CardLike = {
	id: "c1",
	name: "Santander Free Visa",
	bankCode: "90400888",
	last4: "3143",
	closingDay: 31,
	dueDay: 7,
	closingRule: "closing-day-next",
	limitCents: 300000,
	archivedAt: null,
};

describe("abas", () => {
	it("lê a aba da rota e cai em Faturas no resto", () => {
		expect(parseTab("parcelas")).toBe("parcelas");
		expect(parseTab(["limites"])).toBe("limites");
		expect(parseTab("x")).toBe("faturas");
		expect(parseTab(undefined)).toBe("faturas");
	});
});

describe("faturas", () => {
	it("abre a fechada que ainda vai vencer; senão a aberta", () => {
		expect(defaultInvoiceMonth(santander, "2026-11-07")).toBe("2026-11");
		expect(openInvoiceMonth(santander, "2026-11-07")).toBe("2026-12");
		// Depois do vencimento a anterior já venceu: abre a aberta.
		expect(defaultInvoiceMonth(santander, "2026-11-08")).toBe("2026-12");
		// Logo depois de fechar a de novembro (31/10 é dia de fechamento, compra já vai para a seguinte).
		expect(defaultInvoiceMonth(santander, "2026-11-20")).toBe("2026-12");
	});
	it("monta a fila de meses em ordem em volta do mês aberto", () => {
		expect(monthWindow("2026-12", 2, 2)).toEqual(["2026-10", "2026-11", "2026-12", "2027-01", "2027-02"]);
	});
	it("situação e rótulos pelo calendário (venceu, não 'paga')", () => {
		expect(statusOfMonth(santander, "2026-10", "2026-11-07")).toBe("overdue");
		expect(statusOfMonth(santander, "2026-11", "2026-11-07")).toBe("closed");
		expect(statusOfMonth(santander, "2026-12", "2026-11-07")).toBe("open");
		expect(statusLabel("overdue")).toBe("venceu");
		expect(monthChipLabel("overdue", "paid")).toBe("paga");
		expect(monthChipLabel("overdue", "unpaid")).toBe("venceu");
		expect(monthChipLabel("closed", "paid")).toBe("paga");
		expect(monthChipLabel("open", "open")).toBe("aberta");
	});
	it("legenda de datas por situação", () => {
		const base = { closingDate: "2026-10-31", dueDate: "2026-11-07" };
		expect(invoiceDatesCaption({ ...base, status: "closed" })).toBe("Vence 7 de nov · fechou 31 de out");
		expect(invoiceDatesCaption({ ...base, status: "overdue" })).toBe("Venceu 7 de nov · fechou 31 de out");
		expect(invoiceDatesCaption({ closingDate: "2026-11-30", dueDate: "2026-12-07", status: "open" })).toBe(
			"Fecha 30 de nov · vence 7 de dez",
		);
	});
	it("composição: cores fixas e barra sem estorno nem fatia zerada", () => {
		const rows = compositionRows({
			purchasesCents: 26274,
			recurringCents: 12889,
			installmentsCents: 0,
			refundsCents: 500,
		});
		expect(rows.map((r) => r.label)).toEqual(["Compras", "Assinaturas", "Parcelas", "Estornos"]);
		expect(rows.map((r) => r.color)).toEqual([chartSeries[0], chartSeries[1], chartSeries[2], chart.other]);
		expect(compositionBar(rows)).toEqual([
			{ key: "purchases", color: chartSeries[0], weight: 26274 },
			{ key: "subscriptions", color: chartSeries[1], weight: 12889 },
		]);
	});
	const line = (
		id: string,
		date: string,
		extra: Partial<Parameters<typeof filterInvoiceLines>[0][number]> = {},
	) => ({
		id,
		kind: "expense" as const,
		date,
		installmentGroupId: null,
		installmentNumber: null,
		installmentCount: null,
		...extra,
	});
	it("filtra por tipo e ordena do mais novo para o mais velho", () => {
		const lines = [
			line("a", "2026-10-02"),
			line("b", "2026-10-19", { installmentGroupId: "g", installmentNumber: 2, installmentCount: 3 }),
			line("c", "2026-10-14", { kind: "refund" }),
			line("d", "2026-10-19"),
		];
		expect(filterInvoiceLines(lines, "all").map((l) => l.id)).toEqual(["b", "d", "c", "a"]);
		expect(filterInvoiceLines(lines, "purchases").map((l) => l.id)).toEqual(["d", "a"]);
		expect(filterInvoiceLines(lines, "installments").map((l) => l.id)).toEqual(["b"]);
		expect(filterInvoiceLines([], "all")).toEqual([]);
	});
	it("legenda do lançamento: dia/mês, categoria e parcela", () => {
		expect(invoiceLineCaption(line("a", "2026-10-02"), "Mercado")).toBe("02/10 · Mercado");
		expect(
			invoiceLineCaption(line("b", "2026-10-19", { installmentNumber: 2, installmentCount: 3 }), undefined),
		).toBe("19/10 · 2/3");
	});
	it("rótulo do cartão sem os 4 dígitos usa o nome", () => {
		expect(cardLabel(santander)).toBe("•••• 3143");
		expect(cardLabel({ name: "Inter Gold", last4: null })).toBe("Inter Gold");
	});
});

const group = (over: Partial<InstallmentGroupLike> & { months: string[] }): InstallmentGroupLike => {
	const { months, ...rest } = over;
	return {
		groupId: "g",
		description: "KaBuM!",
		cardId: "c1",
		count: months.length,
		totalCents: months.length * 1000,
		paidCents: 0,
		remainingCents: months.length * 1000,
		paidCount: 0,
		remainingCount: months.length,
		installments: months.map((m, i) => ({ invoiceMonth: m, amountCents: 1000, installmentNumber: i + 1 })),
		...rest,
	};
};

describe("parcelas", () => {
	const kabum = group({
		groupId: "k",
		months: ["2026-10", "2026-11", "2026-12", "2027-01"],
		paidCount: 1,
		paidCents: 1000,
		remainingCount: 3,
		remainingCents: 3000,
	});
	const done = group({
		groupId: "d",
		months: ["2026-08"],
		paidCount: 1,
		paidCents: 1000,
		remainingCount: 0,
		remainingCents: 0,
	});
	const other = group({
		groupId: "o",
		cardId: "c2",
		months: ["2026-11", "2026-12"],
		description: "Centauro",
	});

	it("ignora parcelamento já quitado", () => {
		expect(activeGroups([kabum, done]).map((g) => g.groupId)).toEqual(["k"]);
	});
	it("separa o comprometido no mês do que vem depois", () => {
		expect(commitment([kabum, done, other], "2026-11")).toEqual({ committedCents: 2000, futureCents: 3000 });
		expect(commitment([], "2026-11")).toEqual({ committedCents: 0, futureCents: 0 });
	});
	it("colunas por mês, na ordem dos cartões, com o anterior e os seguintes", () => {
		const cols = monthColumns([kabum, other], "2026-11", ["c2", "c1"]);
		expect(cols.map((c) => c.month)).toEqual(["2026-10", "2026-11", "2026-12", "2027-01"]);
		expect(cols[1]?.byCard).toEqual([
			{ cardId: "c2", cents: 1000 },
			{ cardId: "c1", cents: 1000 },
		]);
		expect(cols[3]).toMatchObject({ totalCents: 1000, byCard: [{ cardId: "c1", cents: 1000 }] });
	});
	it("completa os meses que o banco ainda não mandou, para trás e para a frente", () => {
		const partial = group({
			months: ["2026-11"],
			count: 10,
			remainingCount: 7,
			remainingCents: 7000,
			installments: [{ invoiceMonth: "2026-11", amountCents: 1000, installmentNumber: 4 }],
		});
		const cols = monthColumns([partial], "2026-11", ["c1"]);
		expect(cols.map((c) => c.month)).toEqual([
			"2026-08",
			"2026-09",
			"2026-10",
			"2026-11",
			"2026-12",
			"2027-01",
			"2027-02",
			"2027-03",
			"2027-04",
			"2027-05",
		]);
		expect(cols.every((c) => c.totalCents === 1000)).toBe(true);
		expect(commitment([partial], "2026-11")).toEqual({ committedCents: 1000, futureCents: 6000 });
		expect(installmentCard(partial, "2026-11").endLabel).toBe("Termina em maio de 2027 · faltam 7");
	});
	it("sem parcelas, devolve só o primeiro mês vazio", () => {
		expect(monthColumns([], "2026-11", ["c1"])).toEqual([{ month: "2026-11", totalCents: 0, byCard: [] }]);
	});
	it("a cor da barra é a do banco do cartão, pelo código ou pelo nome", () => {
		expect(cardColor({ bankCode: "00416968", name: "Cartão" })).toBe(banks.inter);
		expect(cardColor({ bankCode: null, name: "Nu Pagamentos S.A. - Instituição de Pagamento" })).toBe(
			banks.nubank,
		);
		expect(cardColor({ bankCode: null, name: "Mercado Pago" })).toBe(banks.mercadoPago);
		expect(cardColor({ bankCode: "90400888", name: "FREE VISA" })).toBe(banks.santander);
		expect(cardColor({ bankCode: null, name: "FREE VISA" })).toBe(banks.generic);
	});
	it("abreviação do mês", () => {
		expect(monthAbbrev("2026-11")).toBe("NOV");
		expect(monthAbbrev("2027-03")).toBe("MAR");
	});
	it("cartão do parcelamento: parcela atual, progresso e fim", () => {
		const m = installmentCard(kabum, "2026-11");
		expect(m.progressLabel).toBe("Parcela 2 de 4");
		expect(m.endLabel).toBe("Termina em janeiro de 2027 · faltam 3");
		expect(m.percent).toBe(25);
		expect(m.currentCents).toBe(1000);
	});
	it("última parcela fala no singular", () => {
		const last = group({ months: ["2026-11"], remainingCount: 1 });
		expect(installmentCard(last, "2026-11").endLabel).toBe("Termina em novembro de 2026 · falta 1");
	});
	it("lista por maior saldo e filtra por cartão", () => {
		const big = group({
			groupId: "b",
			description: "Mercado Livre",
			months: ["2026-11", "2026-12", "2027-01", "2027-02", "2027-03"],
		});
		expect(visibleInstallments([kabum, big, other, done], null, "2026-11").map((m) => m.groupId)).toEqual([
			"b",
			"k",
			"o",
		]);
		expect(visibleInstallments([kabum, big, other], "c2", "2026-11").map((m) => m.groupId)).toEqual(["o"]);
	});
});

describe("limites", () => {
	it("usado = faturas não vencidas + parcelas depois da aberta, só do cartão", () => {
		const g = group({ groupId: "g1", months: ["2026-11", "2026-12", "2027-01", "2027-02"] });
		const outro = group({ groupId: "g2", cardId: "c2", months: ["2027-01"] });
		// Aberta é dezembro: janeiro e fevereiro contam (2000); novembro e dezembro já estão nas faturas.
		expect(usedLimitCents([39163, 5000], [g, outro], "c1", "2026-12")).toBe(39163 + 5000 + 2000);
		expect(usedLimitCents([], [], "c1", "2026-12")).toBe(0);
		expect(usedLimitCents([-100], [], "c1", "2026-12")).toBe(0);
	});
	it("meses de uso: fechada + aberta, ou só a aberta", () => {
		expect(usageMonths(santander, "2026-11-07")).toEqual(["2026-11", "2026-12"]);
		expect(usageMonths(santander, "2026-11-08")).toEqual(["2026-12"]);
	});
	it("soma só quem tem limite e conta os que faltam", () => {
		const o = limitsOverview([
			{ cardId: "a", limitCents: 300000, usedCents: 39163 },
			{ cardId: "b", limitCents: 833000, usedCents: 129152 },
			{ cardId: "c", limitCents: null, usedCents: 9999 },
		]);
		expect(o).toEqual({
			totalLimitCents: 1133000,
			usedCents: 168315,
			availableCents: 964685,
			countedCards: 2,
			missingLimit: 1,
			overLimit: false,
		});
	});
	it("passou do limite: disponível zera e marca", () => {
		const o = limitsOverview([{ cardId: "a", limitCents: 1000, usedCents: 1500 }]);
		expect(o).toMatchObject({ availableCents: 0, overLimit: true });
		expect(limitsOverview([])).toMatchObject({ countedCards: 0, totalLimitCents: 0 });
	});
	it("percentual por cartão (passa de 100 se estourou) e nulo sem limite", () => {
		expect(usagePercent(39163, 300000)).toBe(13);
		expect(usagePercent(1500, 1000)).toBe(150);
		expect(usagePercent(10, null)).toBeNull();
		expect(usagePercent(10, 0)).toBeNull();
	});
	it("barra geral: uso por cartão e o resto em cinza", () => {
		const rows = [
			{ cardId: "a", limitCents: 1000, usedCents: 100, color: "#111111" },
			{ cardId: "b", limitCents: 1000, usedCents: 0, color: "#222222" },
			{ cardId: "c", limitCents: null, usedCents: 50, color: "#333333" },
		];
		const o = limitsOverview(rows);
		expect(limitBar(rows, o, "#999999")).toEqual([
			{ key: "a", color: "#111111", weight: 100 },
			{ key: "available", color: "#999999", weight: 1900 },
		]);
	});
	it("ciclo e melhor dia de compra vêm do engine", () => {
		expect(cycleLabel(santander)).toBe("Fecha dia 31 · vence dia 7");
		// Fecha dia 31 (regra padrão): comprar no próprio dia de fechamento rende o prazo máximo.
		expect(bestPurchaseDay(santander, "2026-11-07")).toBe(30);
	});
});

describe("selo de pagamento da fatura", () => {
	const reais = (c: number) => `R$ ${(c / 100).toFixed(2).replace(".", ",")}`;
	const base = { dueDate: "2026-11-07", paidCents: 0 };

	it("paga", () => {
		expect(
			paymentBadge({ ...base, status: "closed", paymentStatus: "paid", paidCents: 10_000 }, 10_000, reais),
		).toEqual({
			label: "Paga",
			tone: "positive",
		});
		// Paga continua paga depois do vencimento.
		expect(paymentBadge({ ...base, status: "overdue", paymentStatus: "paid" }, 10_000, reais).label).toBe(
			"Paga",
		);
	});

	it("paga em parte diz quanto falta", () => {
		const closed = paymentBadge(
			{ ...base, status: "closed", paymentStatus: "partial", paidCents: 4_000 },
			10_000,
			reais,
		);
		expect(closed.label).toBe("Paga em parte (falta R$ 60,00)");
		const late = paymentBadge(
			{ ...base, status: "overdue", paymentStatus: "partial", paidCents: 4_000 },
			10_000,
			reais,
		);
		expect(late.label).toBe("Paga em parte (falta R$ 60,00) · atrasada");
	});

	it("não paga: vence dia X antes do vencimento, Atrasada depois", () => {
		expect(paymentBadge({ ...base, status: "closed", paymentStatus: "unpaid" }, 10_000, reais).label).toBe(
			"Vence dia 7",
		);
		expect(paymentBadge({ ...base, status: "overdue", paymentStatus: "unpaid" }, 10_000, reais).label).toBe(
			"Atrasada",
		);
	});

	it("aberta", () => {
		expect(paymentBadge({ ...base, status: "open", paymentStatus: "open" }, 10_000, reais)).toEqual({
			label: "Em aberto",
			tone: "secondary",
		});
	});
});

describe("fatura paga não 'venceu'", () => {
	const inv = { closingDate: "2026-10-31", dueDate: "2026-11-07" };
	it("legenda e selo seguem o pagamento", () => {
		expect(invoiceDatesCaption({ ...inv, status: "overdue", paymentStatus: "paid" })).toBe(
			"Vencimento 7 de nov · fechou 31 de out",
		);
		expect(invoiceDatesCaption({ ...inv, status: "overdue", paymentStatus: "unpaid" })).toBe(
			"Venceu 7 de nov · fechou 31 de out",
		);
		expect(invoiceStatusTag({ status: "overdue", paymentStatus: "paid" })).toBe("Paga");
		expect(invoiceStatusTag({ status: "closed", paymentStatus: "paid" })).toBe("Paga");
		expect(invoiceStatusTag({ status: "overdue", paymentStatus: "unpaid" })).toBe("Venceu");
		expect(invoiceStatusTag({ status: "open", paymentStatus: "open" })).toBe("Aberta");
	});
});
