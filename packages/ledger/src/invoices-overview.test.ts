import { invoiceFor, type LocalDate, type MonthKey } from "@orbita/core";
import { createMemoryStores, type Stores, toCardConfig } from "@orbita/db";
import { describe, expect, it } from "vitest";
import { invoiceOwedCents, invoicesOverview } from "./invoices-overview.ts";

async function setup(card: { closingDay: number; dueDay: number }) {
	const stores = createMemoryStores({ now: () => new Date("2026-11-12T15:00:00Z") });
	const account = await stores.accounts.create({ name: "Conta", kind: "checking" });
	const created = await stores.cards.create({ name: "Cartão", ...card });
	const config = toCardConfig(created);
	const buy = (date: LocalDate, amountCents: number, invoiceMonth?: MonthKey) =>
		stores.transactions.create({
			kind: "expense",
			amountCents,
			date,
			description: `Compra ${date}`,
			cardId: created.id,
			invoiceMonth: invoiceMonth ?? invoiceFor(date, config).month,
		});
	const pay = (date: LocalDate, amountCents: number) =>
		stores.transactions.create({
			kind: "card_payment",
			amountCents,
			date,
			description: "Fatura",
			accountId: account.id,
			cardId: created.id,
		});
	return { stores, card: created, buy, pay };
}

const only = async (stores: Stores, today: LocalDate) => {
	const overview = await invoicesOverview(stores, today);
	const line = overview.cards[0];
	if (!line) throw new Error("sem cartão");
	return { overview, line };
};

describe("invoicesOverview", () => {
	it("vence no mês seguinte ao fechamento: a fechada a vencer aparece depois do fechamento", async () => {
		const { stores, buy } = await setup({ closingDay: 25, dueDay: 5 });
		await buy("2026-11-20", 10000); // fecha 25/11, vence 05/12 (2026-12)
		await buy("2026-11-28", 3000); // fatura aberta: fecha 25/12, vence 05/01 (2027-01)
		const { overview, line } = await only(stores, "2026-11-28");
		expect(line.open.month).toBe("2027-01");
		expect(line.due.month).toBe("2026-12");
		expect(line.due).toMatchObject({ status: "closed", totalCents: 10000, owedCents: 10000 });
		expect(line.owedCents).toBe(13000);
		expect(line.nextDueDate).toBe("2026-12-05");
		expect(overview.owedCents).toBe(13000);
		expect(overview.nextDueDate).toBe("2026-12-05");
	});

	it("paga a fechada: some da dívida e do limite usado", async () => {
		const { stores, buy, pay } = await setup({ closingDay: 25, dueDay: 5 });
		await buy("2026-11-20", 10000);
		await buy("2026-11-28", 3000);
		await pay("2026-11-29", 10000);
		const { line } = await only(stores, "2026-11-30");
		expect(line.due).toMatchObject({ month: "2026-12", paymentStatus: "paid", owedCents: 0 });
		expect(line.owedCents).toBe(3000);
		expect(line.usedLimitCents).toBe(3000);
		expect(line.nextDueDate).toBe("2027-01-05");
	});

	it("vence no mesmo mês do fechamento (dueDay > closingDay)", async () => {
		const { stores, buy } = await setup({ closingDay: 8, dueDay: 15 });
		await buy("2026-11-05", 8000); // fecha 08/11, vence 15/11
		await buy("2026-11-11", 2000); // aberta: fecha 08/12, vence 15/12
		const { line } = await only(stores, "2026-11-11");
		expect(line.open.month).toBe("2026-12");
		expect(line.due).toMatchObject({ month: "2026-11", status: "closed", owedCents: 8000 });
		expect(line.owedCents).toBe(10000);
		expect(line.nextDueDate).toBe("2026-11-15");
	});

	it("antes do fechamento no ciclo dueDay > closingDay, só a aberta deve", async () => {
		const { stores, buy } = await setup({ closingDay: 8, dueDay: 15 });
		await buy("2026-11-05", 8000);
		const { line } = await only(stores, "2026-11-06");
		expect(line.open.month).toBe("2026-11");
		expect(line.due.month).toBe("2026-11");
		expect(line.owedCents).toBe(8000);
		expect(line.open.status).toBe("open");
	});

	it("virada de ano: fecha em dezembro, vence em janeiro", async () => {
		const { stores, buy } = await setup({ closingDay: 25, dueDay: 5 });
		await buy("2026-12-20", 7000); // fecha 25/12, vence 05/01/2027
		await buy("2026-12-28", 1000); // aberta: vence 05/02/2027
		const { line } = await only(stores, "2026-12-28");
		expect(line.open.month).toBe("2027-02");
		expect(line.due).toMatchObject({ month: "2027-01", dueDate: "2027-01-05", owedCents: 7000 });
		expect(line.owedCents).toBe(8000);
		expect(line.nextDueDate).toBe("2027-01-05");
	});

	it("fevereiro: fechamento dia 31 cai no último dia do mês", async () => {
		const { stores, buy } = await setup({ closingDay: 31, dueDay: 7 });
		await buy("2027-02-10", 5000); // fecha 28/02, vence 07/03
		await buy("2027-03-02", 1500); // aberta: fecha 31/03, vence 07/04
		const { line } = await only(stores, "2027-03-02");
		expect(line.open.month).toBe("2027-04");
		expect(line.due).toMatchObject({ month: "2027-03", dueDate: "2027-03-07", status: "closed" });
		expect(line.due.closingDate).toBe("2027-02-28");
		expect(line.owedCents).toBe(6500);
	});

	it("limite usado soma o devido e as parcelas depois da aberta, sem contar fatura paga", async () => {
		const { stores, card, buy, pay } = await setup({ closingDay: 25, dueDay: 5 });
		await buy("2026-11-20", 10000);
		await stores.transactions.createInstallmentGroup(
			(["2026-11", "2026-12", "2027-01", "2027-02", "2027-03"] as const).map((m, i) => ({
				kind: "expense" as const,
				amountCents: 2000,
				date: "2026-11-20",
				description: "TV 5x",
				cardId: card.id,
				invoiceMonth: m,
				budgetMonth: m,
				installmentNumber: i + 1,
				installmentCount: 5,
			})),
		);
		// Aberta em 28/11 é 2027-01: fevereiro e março (2 x 2000) ainda não estão em fatura nenhuma.
		const before = await only(stores, "2026-11-28");
		expect(before.line.usedLimitCents).toBe(before.line.owedCents + 4000);
		await pay("2026-11-29", before.line.due.owedCents);
		const after = await only(stores, "2026-11-30");
		expect(after.line.usedLimitCents).toBe(before.line.usedLimitCents - before.line.due.owedCents);
	});
});

describe("limite com parcelamento", () => {
	it("a parcela vigente (já no devido) não entra duas vezes na conferência do limite do banco", async () => {
		const { stores, card } = await setup({ closingDay: 25, dueDay: 5 });
		await stores.cards.update(card.id, { limitCents: 100_000 });
		await stores.transactions.createInstallmentGroup(
			(["2026-11", "2026-12", "2027-01", "2027-02", "2027-03"] as const).map((m, i) => ({
				kind: "expense" as const,
				amountCents: 2000,
				date: "2026-11-10",
				description: "TV 5x",
				cardId: card.id,
				invoiceMonth: m,
				budgetMonth: m,
				installmentNumber: i + 1,
				installmentCount: 5,
			})),
		);
		// Devido 2.000 (a 1/5 na aberta) + 8.000 que faltam = 10.000. O banco diz usado 21.000, acima do plausível
		// (10.000) mais a tolerância (10.000); contando a vigente duas vezes (12.000) ele passaria por coerente.
		await stores.cards.recordAvailable(card.id, 79_000, new Date("2026-11-12T12:00:00Z"), null);
		const { line } = await only(stores, "2026-11-12");
		expect(line.limit).toMatchObject({ source: "estimated", usedCents: 10_000 });
	});
});

describe("parcela projetada na fatura aberta", () => {
	it("a parcela que o devido já projeta não entra de novo nas que faltam (limite usado)", async () => {
		const { stores, card } = await setup({ closingDay: 25, dueDay: 5 });
		// Só a 1/5 (nov) lançada: a 2/5 ainda não existe e é projetada na aberta (2026-12).
		await stores.transactions.createInstallmentGroup(
			(["2026-11"] as const).map((m, i) => ({
				kind: "expense" as const,
				amountCents: 2000,
				date: "2026-10-10",
				description: "TV 5x",
				cardId: card.id,
				invoiceMonth: m,
				budgetMonth: m,
				installmentNumber: i + 1,
				installmentCount: 5,
			})),
		);
		const { line } = await only(stores, "2026-11-12");
		expect(line.open.month).toBe("2026-12");
		// Devido: 1/5 (fechada de nov, 2.000) + 2/5 projetada na aberta (2.000). Faltam depois dela a 3/5, 4/5 e 5/5.
		expect(line.owedCents).toBe(4000);
		expect(line.usedLimitCents).toBe(10_000);
	});
});

describe("invoiceOwedCents", () => {
	it("aberta deve o total; fechada, o total menos o pago, nunca negativo", () => {
		expect(invoiceOwedCents("open", 5000, 0)).toBe(5000);
		expect(invoiceOwedCents("closed", 5000, 2000)).toBe(3000);
		expect(invoiceOwedCents("overdue", 5000, 9000)).toBe(0);
		expect(invoiceOwedCents("open", -100, 0)).toBe(0);
	});
});

describe("histórico de faturas: estados das barras", () => {
	it("fatura antiga fechada sem pagamento conhecido é histórico neutro (history), nunca overdue ou closed", async () => {
		const { stores, buy } = await setup({ closingDay: 25, dueDay: 5 });
		await buy("2026-07-10", 5000); // 2026-08: fora dos meses considerados em 28/11
		await buy("2026-10-10", 7000); // 2026-11: vencida há pouco, conta como overdue
		const { overview } = await only(stores, "2026-11-28");
		const aug = overview.history.find((h) => h.month === "2026-08");
		expect(aug).toMatchObject({ totalCents: 5000, state: "history" });
		expect(aug?.byCard[0]?.state).toBe("history");
		expect(overview.history.find((h) => h.month === "2026-11")?.state).toBe("overdue");
	});

	it("meses depois do aberto vêm com open false e state open; só o mês aberto tem open true", async () => {
		const { stores, buy } = await setup({ closingDay: 25, dueDay: 5 });
		await buy("2026-11-20", 10000);
		await buy("2026-11-28", 3000, "2027-02");
		const { overview } = await only(stores, "2026-11-28");
		expect(overview.history.filter((h) => h.open).map((h) => h.month)).toEqual(["2027-01"]);
		const future = overview.history.find((h) => h.month === "2027-02");
		expect(future).toMatchObject({ open: false, state: "open", totalCents: 3000 });
	});
});
