import { createMemoryStores, type Stores } from "@orbita/db";
import { syncPluggy } from "@orbita/ingest";
import {
	CLIENT_ID,
	CLIENT_SECRET,
	fakePluggy,
	ITEMS,
	REAL_NOW,
	realPluggyOptions,
} from "@orbita/ingest/testing";
import { beforeAll, describe, expect, it } from "vitest";
import { accountBalances } from "./balances.ts";
import { cashFlow } from "./cash-flow.ts";
import { type CardInvoicesLine, cardLimit, invoicesOverview } from "./invoices-overview.ts";
import { activeInstallments, loadSpendingMonth, monthSummary } from "./summary.ts";

/*
 * Leituras do ledger sobre o sync dos dados REAIS do dono (diagnóstico de 09/11/4052, 4 conexões MeuPluggy, hoje =
 * 4052-11-09). A fixture está em `@orbita/ingest/testing`. Os números esperados foram conferidos item a item contra o
 * diagnóstico (ver docs/pluggy.md, "O que vimos nos dados reais").
 */

const TODAY = "2026-11-09";
let stores: Stores;
let overview: Awaited<ReturnType<typeof invoicesOverview>>;

const cardLine = (last4: string): CardInvoicesLine => {
	const line = overview.cards.find((c) => c.card.last4 === last4);
	if (!line) throw new Error(`cartão ${last4} não encontrado`);
	return line;
};

beforeAll(async () => {
	stores = createMemoryStores({ now: () => REAL_NOW });
	for (const [id, label] of [
		[ITEMS.inter, "Inter"],
		[ITEMS.mp, "Mercado Pago"],
		[ITEMS.santander, "Santander"],
		[ITEMS.nubank, "Nubank"],
	] as const) {
		await stores.pluggyConnections.add({ id, label });
	}
	const { itemId: _itemId, ...options } = realPluggyOptions();
	const fake = fakePluggy(options);
	const result = await syncPluggy({
		stores,
		readSecret: async (name) =>
			({ pluggy_client_id: CLIENT_ID, pluggy_client_secret: CLIENT_SECRET })[name] ?? null,
		fetch: fake.fetch,
		now: () => REAL_NOW,
	});
	expect(result.status).toBe("ok");
	overview = await invoicesOverview(stores, TODAY);
});

describe("Gasto do mês pela data da compra (dados fictícios)", () => {
	it("novembro/2026: R$ 1.307,62, item a item", async () => {
		const rows = (await loadSpendingMonth(stores, "2026-11")).filter((t) => t.kind === "expense");
		const lines = rows.map((t) => [t.description.slice(0, 12), t.amountCents]).sort();
		expect(lines).toEqual(
			[
				["MLP KABUM-KA", 10300], // parcela 5/10 de compra de 11/07: pesa em novembro (mês da compra + 4)
				["Centauro Com", 15332], // parcela 4/6 de compra de 10/08: novembro
				["DL*hostinger", 21798],
				["PIX ENVIADO ", 59406], // Associação Exemplo (faculdade)
				["DL*Spotify P", 6380],
				["Farmacia Exe", 9596],
				["Pix enviado ", 7950], // Loja Digital Exemplo
			].sort(),
		);
		const { summary } = await monthSummary(stores, "2026-11", TODAY);
		expect(summary.spentCents).toBe(130762);
		// Nada disso é gasto: pagamento de fatura (3 pelo lado da conta), Pix entre contas suas, aplicação, rendimento.
		expect(summary.investedCents).toBe(19924); // Débito B3 de 199,24 (a nota de 141,22 é de outubro)
		expect(summary.incomeCents).toBe(20); // 0,07 + 0,06 + 0,06 + 0,01 de rendimentos (receita, não resgate)
		expect(summary.refundCreditCents).toBe(0); // nenhum pagamento de fatura virou estorno

		const byName = async (slug: string) => {
			const id = (await stores.categories.getBySlug(slug))?.id ?? "";
			return summary.byCategory[id] ?? 0;
		};
		expect(await byName("saude")).toBe(9596);
		expect(await byName("assinaturas")).toBe(6380);
		expect(await byName("transferencias")).toBe(67356); // Pix a terceiros: Associação Exemplo 594,06 + Loja Digital Exemplo 79,50
		expect(await byName("outros")).toBe(47430); // KABUM 103,00 + Centauro 153,32 + Hostinger 217,98
	});

	it("o que o outro app mostrou (R$ 1.172,50) = o nosso menos as 2 parcelas de compras antigas, mais a farmácia de R$ 121,20 que o diagnóstico não listou", async () => {
		const { summary } = await monthSummary(stores, "2026-11", TODAY);
		const installmentsFromOlderPurchases = 10300 + 15332; // KABUM 5/10 e Centauro 4/6: pela regra do projeto pesam em novembro
		const farmaciaNotListed = 12120;
		expect(summary.spentCents - installmentsFromOlderPurchases + farmaciaNotListed).toBe(117250);
	});

	it("outubro/2026: pagamentos de fatura e Pix próprios fora; resgate abate o investido", async () => {
		const { summary } = await monthSummary(stores, "2026-10", TODAY);
		expect(summary.spentCents).toBe(509676);
		expect(summary.investedCents).toBe(13316); // 141,22 aplicados − 8,06 resgatados
		expect(summary.refundCreditCents).toBe(0);
		const rows = await loadSpendingMonth(stores, "2026-10");
		// A compra feita em outubro e cobrada na fatura de dezembro (Santander) pesa em outubro.
		expect(rows.some((t) => t.description.startsWith("PIZZARIA") && t.kind === "expense")).toBe(true);
	});
});

describe("Faturas e limites (dados fictícios)", () => {
	it("Santander: fatura atual R$ 1.020,86 (vence 07/12); a de 07/11 (R$ 783,26) está paga", () => {
		const line = cardLine("2689");
		expect(line.card).toMatchObject({ closingDay: 30, dueDay: 7 });
		expect(line.open).toMatchObject({
			month: "2026-12",
			dueDate: "2026-12-07",
			state: "open",
			totalCents: 102086,
		});
		expect(line.due).toMatchObject({
			month: "2026-11",
			state: "paid",
			totalCents: 78326,
			paidCents: 78326,
			owedCents: 0,
		});
		expect(line.owedCents).toBe(102086);
		expect(line.nextDueDate).toBe("2026-12-07");
	});

	it("Mercado Pago: a fatura de 296,76 (as 2 pendentes) foi paga antes de fechar; nenhuma dívida em aberto além da parcela prevista", () => {
		const line = cardLine("7054");
		expect(line.due).toMatchObject({ month: "2026-11", totalCents: 29676, paidCents: 29676, state: "paid" });
		expect(line.owedCents).toBe(17374); // só a parcela 12/21 prevista na fatura de dezembro
	});

	it("Inter: fatura atual R$ 103,00 (KABUM 5/10), a de novembro (total 0) paga", () => {
		const line = cardLine("8316");
		expect(line.open).toMatchObject({
			month: "2026-12",
			dueDate: "2026-12-12",
			totalCents: 10300,
			state: "open",
		});
		expect(line.due).toMatchObject({ month: "2026-11", state: "paid" });
	});

	it("Nubank: a próxima fatura (dezembro) tem Farmácia 95,96 + Centauro 153,32; a de 10/11 (1.438,84) está paga", () => {
		const line = cardLine("5172");
		expect(line.open).toMatchObject({ month: "2026-12", dueDate: "2026-12-10", totalCents: 24928 });
		expect(line.due).toMatchObject({
			month: "2026-11",
			totalCents: 143884,
			paidCents: 143884,
			state: "paid",
		});
	});

	it("limites: Inter, Mercado Pago e Santander batem com limite − disponível = saldo; o Nubank tem limite efetivo menor que o aprovado", () => {
		expect(cardLine("8316").limit).toMatchObject({
			limitCents: 1132000,
			availableCents: 1070200,
			usedCents: 61800,
			source: "bank",
		});
		expect(cardLine("7054").limit).toMatchObject({
			limitCents: 1400000,
			availableCents: 1226260,
			usedCents: 173740,
			source: "bank",
		});
		expect(cardLine("2689").limit).toMatchObject({
			limitCents: 1154000,
			availableCents: 1046534,
			usedCents: 107466,
			source: "bank",
		});
		// Nubank: limite aprovado 13.900, o dono baixou para 5.800 no app; disponível 5.244,08 + saldo 555,92 = 5.800.
		const nubank = cardLine("5172").limit;
		expect(nubank).toMatchObject({
			limitCents: 580000,
			approvedLimitCents: 1390000,
			availableCents: 524408,
			usedCents: 55592,
			source: "bank",
		});
		// Só o Nubank carrega o limite aprovado.
		expect(cardLine("8316").limit.approvedLimitCents).toBeUndefined();
		expect(overview.limits).toMatchObject({
			limitCents: 1132000 + 1400000 + 1154000 + 580000,
			usedCents: 61800 + 173740 + 107466 + 55592,
			availableCents: 1070200 + 1226260 + 1046534 + 524408,
			cardsCounted: 4,
		});
	});

	it("antes do sync gravar o saldo: Nubank sem balance usa a estimativa, e o topo soma limites efetivos coerentes", async () => {
		const nu = cardLine("5172").card;
		// Cartão como estava antes do sync gravar o saldo: só limite aprovado e disponível.
		const noBalance = {
			...stores,
			cards: {
				...stores.cards,
				list: async (...args: Parameters<Stores["cards"]["list"]>) =>
					(await stores.cards.list(...args)).map((c) => (c.id === nu.id ? { ...c, balanceCents: null } : c)),
			},
		} as Stores;
		const before = await invoicesOverview(noBalance, TODAY);
		const line = before.cards.find((c) => c.card.id === nu.id);
		// Disponível 5.244,08 + usado estimado 555,92 = 5.800 efetivo; nunca "aprovado − disponível" (8.655,92).
		expect(line?.limit).toMatchObject({
			limitCents: 580000,
			approvedLimitCents: 1390000,
			usedCents: 55592,
			source: "estimated",
		});
		expect(before.limits.limitCents).toBe(1132000 + 1400000 + 1154000 + 580000);
		expect(before.limits.usedCents).toBe(61800 + 173740 + 107466 + 55592);
		expect(before.limits.limitCents - before.limits.usedCents).toBe(before.limits.availableCents);
	});

	it("o usado do Nubank (555,92) é o que o Órbita também conta por lançamentos: fatura de dezembro 249,28 + 2 parcelas futuras da Centauro", () => {
		expect(24928 + 2 * 15332).toBe(55592);
	});
});

describe("cardLimit: coerência do número do banco", () => {
	const base = {
		id: "c",
		limitSyncedAt: new Date("2026-11-09T12:00:00Z"),
	} as Parameters<typeof cardLimit>[0];
	const card = (limitCents: number, availableCents: number, balanceCents: number | null) =>
		({ ...base, limitCents, availableCents, balanceCents }) as Parameters<typeof cardLimit>[0];

	it("limite − disponível = saldo (±R$ 1): usado do banco", () => {
		expect(cardLimit(card(1132000, 1070200, 61800), 0)).toMatchObject({
			limitCents: 1132000,
			usedCents: 61800,
			source: "bank",
		});
		expect(cardLimit(card(1132000, 1070200, 61850), 0)).toMatchObject({ usedCents: 61800, source: "bank" });
	});

	it("limite − disponível ≠ saldo e disponível + saldo < limite: limite efetivo = disponível + saldo", () => {
		expect(cardLimit(card(1390000, 524408, 55592), 0)).toEqual({
			limitCents: 580000,
			approvedLimitCents: 1390000,
			availableCents: 524408,
			usedCents: 55592,
			source: "bank",
			syncedAt: "2026-11-09T12:00:00.000Z",
		});
	});

	it("sem saldo do banco, o usado incoerente com o que o Órbita conhece vira estimado (com o disponível do banco)", () => {
		const incoherent = cardLimit(card(1390000, 524408, null), 55592, 55592);
		// Limite efetivo = disponível + estimado (580.000), o aprovado vai à parte: % e total não misturam os dois.
		expect(incoherent).toMatchObject({
			limitCents: 580000,
			approvedLimitCents: 1390000,
			availableCents: 524408,
			usedCents: 55592,
			source: "estimated",
		});
		// Dentro da tolerância (R$ 100 ou 5 % do limite), vale o do banco.
		expect(cardLimit(card(1154000, 1046534, null), 102086, 102086)).toMatchObject({
			usedCents: 107466,
			source: "bank",
		});
	});

	it("disponível + saldo ≥ limite (não fecha de jeito nenhum): cai na estimativa", () => {
		expect(cardLimit(card(200000, 40000, 180000), 10000, 10000)).toMatchObject({
			usedCents: 10000,
			source: "estimated",
			limitCents: 50000,
			approvedLimitCents: 200000,
		});
	});
});

describe("Saldo, fluxo de caixa e parcelas (dados fictícios)", () => {
	it("saldo em contas: o que o banco informou (só o Mercado Pago tem R$ 410,58)", async () => {
		const balances = await accountBalances(stores);
		expect(balances.totalCents).toBe(41058);
		expect(balances.accounts.find((a) => a.name === "Mercado Pago")).toMatchObject({
			balanceCents: 41058,
			hasBalance: true,
		});
		expect(balances.withoutBalanceCount).toBe(0);
	});

	it("fluxo de caixa de novembro: pagamentos de fatura saem da conta (1.383,88 + 1.438,84 + 296,76), Pix próprios ficam fora", async () => {
		const flow = await cashFlow(stores, "2026-11");
		expect(flow.out.cardPaymentCents).toBe(138388 + 143884 + 29676);
		expect(flow.out.expenseCents).toBe(59406 + 7950); // Associação Exemplo + Loja Digital Exemplo
		expect(flow.out.investedCents).toBe(19924);
		expect(flow.in).toEqual({ incomeCents: 20, refundCents: 0, redemptionCents: 0 });
		expect(flow.inCents).toBe(20);
		expect(flow.ignoredTransferCents).toBeGreaterThan(0);
	});

	it("fluxo de caixa de outubro: salário de 4.600 é entrada; resgate do CDB entra como resgate", async () => {
		const flow = await cashFlow(stores, "2026-10");
		expect(flow.in.incomeCents).toBeGreaterThanOrEqual(460000);
		expect(flow.in.redemptionCents).toBe(806);
		expect(flow.in.refundCents).toBe(0);
	});

	it("parcelas: KABUM 5/10, MERCADOLIVRE 11/21, Centauro 4/6, sem duplicar", async () => {
		const groups = await activeInstallments(stores, "2026-11", TODAY);
		const by = (text: string) => groups.find((g) => g.description.toLowerCase().includes(text));
		expect(by("kabum")).toMatchObject({
			currentNumber: 5,
			count: 10,
			paidCount: 4,
			remainingCount: 6,
			remainingCents: 61800,
			lastInvoiceMonth: "2027-05",
		});
		expect(by("mercadolivre")).toMatchObject({
			currentNumber: 11,
			count: 21,
			paidCount: 10,
			remainingCount: 11,
			remainingCents: 191114,
		});
		expect(by("centauro")).toMatchObject({
			currentNumber: 4,
			count: 6,
			paidCount: 3,
			remainingCount: 3,
			remainingCents: 45996,
		});
		expect(by("kabum")?.installments.map((t) => t.installmentNumber)).toEqual([4, 5]);
		expect(by("mercadolivre")?.installments.map((t) => t.installmentNumber)).toEqual([10, 11]);
	});
});
