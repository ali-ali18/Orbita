import { describe, expect, it } from "vitest";
import {
	evolutionRangeStart,
	type InvestmentMovementInput,
	type InvestmentPositionInput,
	type InvestmentSnapshotInput,
	investmentClassOf,
	investmentEvolution,
	isActiveInvestment,
	monthlyInvestments,
	monthYield,
	NO_HISTORY_REASON,
	portfolioBreakdown,
	portfolioYield,
	positionYield,
	roundedDiv,
	shareBasisPoints,
} from "./investments.ts";

// Tudo fictício. "Hoje" é 2026-11-15.
const TODAY = "2026-11-15";

const pos = (id: string, extra: Partial<InvestmentPositionInput> = {}): InvestmentPositionInput => ({
	id,
	type: "FIXED_INCOME",
	subtype: "CDB",
	status: "ACTIVE",
	currency: "BRL",
	balanceCents: 1000000,
	investedCents: null,
	archived: false,
	institutionKey: "item-a",
	institutionLabel: "Banco A",
	...extra,
});

const mv = (
	investmentId: string,
	type: string,
	date: string | null,
	amountCents: number | null,
	extra: Partial<InvestmentMovementInput> = {},
): InvestmentMovementInput => ({
	investmentId,
	type,
	date,
	tradeDate: null,
	amountCents,
	netAmountCents: null,
	...extra,
});

const snap = (
	investmentId: string,
	day: string,
	balanceCents: number,
	investedCents: number | null = null,
): InvestmentSnapshotInput => ({ investmentId, day, balanceCents, investedCents });

describe("classe", () => {
	it("renda fixa (com Tesouro dentro), ações (com ETF), fundos e outros", () => {
		expect(investmentClassOf("FIXED_INCOME", "CDB")).toBe("fixed_income");
		expect(investmentClassOf("FIXED_INCOME", "TREASURY")).toBe("fixed_income");
		expect(investmentClassOf("TREASURY", null)).toBe("fixed_income");
		expect(investmentClassOf("EQUITY", "STOCK")).toBe("equity");
		expect(investmentClassOf("ETF", "ETF")).toBe("equity");
		expect(investmentClassOf("MUTUAL_FUND", "REAL_ESTATE_FUND")).toBe("fund");
		expect(investmentClassOf("COE", null)).toBe("other");
		expect(investmentClassOf(null, null)).toBe("other");
		// Sem tipo, o subtipo decide.
		expect(investmentClassOf(null, "lci")).toBe("fixed_income");
		expect(investmentClassOf("OTHER", "STOCK")).toBe("equity");
	});

	it("ativa: não arquivada e não resgatada por inteiro", () => {
		expect(isActiveInvestment({ archived: false, status: "ACTIVE" })).toBe(true);
		expect(isActiveInvestment({ archived: false, status: null })).toBe(true);
		expect(isActiveInvestment({ archived: false, status: "total_withdrawal" })).toBe(false);
		expect(isActiveInvestment({ archived: true, status: "ACTIVE" })).toBe(false);
	});
});

describe("rendimento da posição", () => {
	it("renda fixa com aplicado: saldo − aplicado, exato", () => {
		expect(positionYield(pos("a", { balanceCents: 1043257, investedCents: 1000000 }), [])).toEqual({
			cents: 43257,
			estimated: false,
			basis: "invested",
			basisCents: 1000000,
			reason: null,
		});
	});

	it("perda é negativa", () => {
		expect(positionYield(pos("a", { balanceCents: 990000, investedCents: 1000000 }), []).cents).toBe(-10000);
	});

	it("sem aplicado (ação): saldo − (compras − vendas), estimado", () => {
		const movements = [
			mv("a", "BUY", "2026-01-10", 100000),
			mv("a", "BUY", "2026-02-10", 50000),
			mv("a", "SELL", "2026-03-10", 30000),
			mv("a", "TAX", "2026-03-10", 999), // não é aporte nem resgate
			mv("b", "BUY", "2026-03-10", 777777), // outra posição
		];
		expect(
			positionYield(pos("a", { type: "EQUITY", subtype: "STOCK", balanceCents: 140000 }), movements),
		).toEqual({
			cents: 20000,
			estimated: true,
			basis: "movements",
			basisCents: 120000,
			reason: null,
		});
	});

	it("aplicado zero conta como ausente e cai nas movimentações", () => {
		const y = positionYield(pos("a", { balanceCents: 1100, investedCents: 0 }), [
			mv("a", "BUY", "2026-01-01", 1000),
		]);
		expect(y).toMatchObject({ cents: 100, estimated: true, basis: "movements" });
	});

	it("usa o valor com despesas quando o bruto falta; linha sem valor não conta", () => {
		const movements = [
			mv("a", "BUY", "2026-01-01", null, { netAmountCents: 1010 }),
			mv("a", "BUY", "2026-01-02", null),
		];
		expect(positionYield(pos("a", { balanceCents: 1500, investedCents: null }), movements).cents).toBe(490);
	});

	it("sem aplicado e sem compra: null com motivo (só venda não basta: o histórico pode estar cortado)", () => {
		const none = positionYield(pos("a", { balanceCents: 500 }), []);
		expect(none).toMatchObject({ cents: null, basis: "unavailable", estimated: false });
		expect(none.reason).toContain("sem valor aplicado");
		expect(
			positionYield(pos("a", { balanceCents: 500 }), [mv("a", "SELL", "2026-01-01", 900)]).cents,
		).toBeNull();
	});

	it("sem saldo: null, nunca zero", () => {
		expect(positionYield(pos("a", { balanceCents: null, investedCents: 100 }), [])).toMatchObject({
			cents: null,
			reason: "sem saldo informado",
		});
	});
});

describe("rendimento da carteira", () => {
	it("soma só as ativas; mistura exata e estimada marca estimado; percentual em pontos-base", () => {
		const positions = [
			pos("cdb", { balanceCents: 1050000, investedCents: 1000000 }),
			pos("acao", { type: "EQUITY", subtype: "STOCK", balanceCents: 210000 }),
			pos("zerado", { status: "TOTAL_WITHDRAWAL", balanceCents: 0, investedCents: 500000 }),
			pos("sumiu", { archived: true, balanceCents: 999999, investedCents: 1 }),
		];
		const movements = [mv("acao", "BUY", "2026-01-10", 200000)];
		expect(portfolioYield(positions, movements)).toEqual({
			cents: 60000,
			estimated: true,
			countedPositions: 2,
			missingPositions: 0,
			basisCents: 1200000,
			returnBps: 500,
			reason: null,
		});
	});

	it("posição sem como calcular fica de fora e é contada", () => {
		const r = portfolioYield(
			[pos("a", { balanceCents: 1100, investedCents: 1000 }), pos("b", { balanceCents: 5000 })],
			[],
		);
		expect(r).toMatchObject({ cents: 100, estimated: false, countedPositions: 1, missingPositions: 1 });
	});

	it("nenhuma calculável: null com motivo; sem posições: outro motivo", () => {
		expect(portfolioYield([pos("a", { balanceCents: 5000 })], [])).toMatchObject({
			cents: null,
			missingPositions: 1,
			reason: "sem valor aplicado nem compras para calcular",
		});
		expect(portfolioYield([], [])).toMatchObject({ cents: null, reason: "sem posições ativas" });
	});

	it("outra moeda não se mistura", () => {
		const r = portfolioYield([pos("usd", { currency: "USD", balanceCents: 9999, investedCents: 1 })], []);
		expect(r.cents).toBeNull();
	});
});

describe("rendimento do mês", () => {
	const positions = [pos("cdb", { balanceCents: 1020000 })];

	it("com retrato do fim do mês anterior: saldo agora − saldo inicial − (aportes − resgates) do mês", () => {
		const r = monthYield({
			positions,
			movements: [mv("cdb", "BUY", "2026-11-05", 50000), mv("cdb", "SELL", "2026-11-10", 20000)],
			snapshots: [snap("cdb", "2026-10-31", 1000000)],
			month: "2026-11",
			today: TODAY,
		});
		// 1.020.000 − 1.000.000 − (50.000 − 20.000) = −10.000
		expect(r).toMatchObject({
			month: "2026-11",
			cents: -10000,
			countedPositions: 1,
			missingPositions: 0,
			baselineDay: "2026-10-31",
			reason: null,
		});
	});

	it("movimentação anterior ao retrato não entra (já está no saldo dele)", () => {
		const r = monthYield({
			positions,
			movements: [mv("cdb", "BUY", "2026-10-20", 500000), mv("cdb", "BUY", "2026-11-02", 10000)],
			snapshots: [snap("cdb", "2026-10-28", 1000000)],
			month: "2026-11",
			today: TODAY,
		});
		// retrato de 28/10 (3 dias antes do fim do mês anterior: vale); só o aporte de 02/11 desconta.
		expect(r.cents).toBe(1020000 - 1000000 - 10000);
		expect(r.baselineDay).toBe("2026-10-28");
	});

	it("sem retrato do início do mês: null com 'sem histórico ainda' (nunca inventa)", () => {
		const r = monthYield({
			positions,
			movements: [mv("cdb", "BUY", "2026-01-05", 1000000)],
			snapshots: [snap("cdb", "2026-11-10", 1015000)], // o primeiro retrato é de depois do início do mês
			month: "2026-11",
			today: TODAY,
		});
		expect(r).toMatchObject({
			cents: null,
			reason: NO_HISTORY_REASON,
			countedPositions: 0,
			missingPositions: 1,
		});
		expect(
			monthYield({ positions, movements: [], snapshots: [], month: "2026-11", today: TODAY }).reason,
		).toBe(NO_HISTORY_REASON);
	});

	it("retrato velho demais (mais de 5 dias) não serve de início", () => {
		const r = monthYield({
			positions,
			movements: [],
			snapshots: [snap("cdb", "2026-10-20", 1000000)],
			month: "2026-11",
			today: TODAY,
		});
		expect(r.cents).toBeNull();
	});

	it("posição aberta no mês (primeira movimentação no mês, sem retrato antes) parte de zero", () => {
		const r = monthYield({
			positions: [pos("acao", { type: "EQUITY", subtype: "STOCK", balanceCents: 105000 })],
			movements: [mv("acao", "BUY", "2026-11-03", 100000)],
			snapshots: [snap("acao", "2026-11-12", 104000)],
			month: "2026-11",
			today: TODAY,
		});
		expect(r).toMatchObject({ cents: 5000, countedPositions: 1, baselineDay: "2026-11-01" });
	});

	it("cobertura parcial: soma só quem tem ponto de partida e conta quem ficou de fora", () => {
		const r = monthYield({
			positions: [pos("a", { balanceCents: 1010000 }), pos("b", { balanceCents: 777 })],
			movements: [mv("b", "BUY", "2026-01-01", 700)],
			snapshots: [snap("a", "2026-10-31", 1000000)],
			month: "2026-11",
			today: TODAY,
		});
		expect(r).toMatchObject({ cents: 10000, countedPositions: 1, missingPositions: 1 });
	});

	it("resgatada por inteiro no mês: saldo final zero, o resgate desconta", () => {
		const r = monthYield({
			positions: [pos("cdb", { status: "TOTAL_WITHDRAWAL", archived: true, balanceCents: 0 })],
			movements: [mv("cdb", "SELL", "2026-11-04", 1004000)],
			snapshots: [snap("cdb", "2026-10-31", 1000000), snap("cdb", "2026-11-04", 0)],
			month: "2026-11",
			today: TODAY,
		});
		expect(r.cents).toBe(4000);
	});

	it("resgatada antes do mês (último retrato zero, há tempos) é ignorada, sem virar 'faltando'", () => {
		const r = monthYield({
			positions: [
				pos("velha", { status: "TOTAL_WITHDRAWAL", archived: true, balanceCents: 0 }),
				pos("cdb", { balanceCents: 1010000 }),
			],
			movements: [],
			snapshots: [snap("velha", "2026-03-01", 0), snap("cdb", "2026-10-31", 1000000)],
			month: "2026-11",
			today: TODAY,
		});
		expect(r).toMatchObject({ cents: 10000, countedPositions: 2, missingPositions: 0 });
	});

	it("posição que sumiu da lista não vira perda inventada (saldo desconhecido)", () => {
		const r = monthYield({
			positions: [pos("sumiu", { archived: true, status: "ACTIVE", balanceCents: 500000 })],
			movements: [],
			snapshots: [snap("sumiu", "2026-10-31", 500000), snap("sumiu", "2026-11-05", 500000)],
			month: "2026-11",
			today: TODAY,
		});
		expect(r).toMatchObject({ cents: null, missingPositions: 1 });
	});

	it("mês passado usa o retrato do fim do mês (e antes da posição existir não há rendimento)", () => {
		const base = {
			positions,
			movements: [mv("cdb", "BUY", "2026-10-10", 100000)],
			snapshots: [snap("cdb", "2026-09-30", 900000), snap("cdb", "2026-10-31", 1010000)],
			today: TODAY,
		};
		expect(monthYield({ ...base, month: "2026-10" }).cents).toBe(1010000 - 900000 - 100000);
		// Setembro: há retrato do fim do mês, mas nada que diga de onde a posição partiu (primeira movimentação é de outubro).
		expect(monthYield({ ...base, month: "2026-09" })).toMatchObject({
			cents: null,
			reason: NO_HISTORY_REASON,
		});
		// Antes de a posição existir não há o que medir.
		expect(monthYield({ ...base, month: "2026-08" })).toMatchObject({ cents: null, reason: "sem posições" });
	});

	it("outra moeda fica fora", () => {
		const r = monthYield({
			positions: [pos("usd", { currency: "USD" })],
			movements: [],
			snapshots: [snap("usd", "2026-10-31", 1)],
			month: "2026-11",
			today: TODAY,
		});
		expect(r.cents).toBeNull();
	});
});

describe("aportes e rendimento por mês", () => {
	it("aportes e resgates das movimentações; rendimento null onde falta retrato", () => {
		const r = monthlyInvestments({
			positions: [pos("cdb", { balanceCents: 1030000 })],
			movements: [
				mv("cdb", "BUY", "2026-09-02", 800000),
				mv("cdb", "BUY", "2026-10-05", 100000),
				mv("cdb", "SELL", "2026-10-20", 30000),
				mv("cdb", "BUY", null, 5), // sem data: fora
			],
			snapshots: [snap("cdb", "2026-09-30", 805000), snap("cdb", "2026-10-31", 885000)],
			today: TODAY,
			months: 4,
		});
		expect(r.map((m) => m.month)).toEqual(["2026-08", "2026-09", "2026-10", "2026-11"]);
		// Antes de a posição existir: sem aporte e sem rendimento (null, com motivo).
		expect(r[0]).toMatchObject({
			contributionsCents: 0,
			netContributionsCents: 0,
			yieldCents: null,
			yieldReason: "sem posições",
		});
		// Setembro: posição aberta no mês, parte de zero. 805.000 − 0 − 800.000.
		expect(r[1]).toMatchObject({
			contributionsCents: 800000,
			withdrawalsCents: 0,
			netContributionsCents: 800000,
			yieldCents: 5000,
		});
		expect(r[2]).toMatchObject({
			contributionsCents: 100000,
			withdrawalsCents: 30000,
			netContributionsCents: 70000,
			// 885.000 − 805.000 − 70.000
			yieldCents: 10000,
			yieldReason: null,
			yieldPartial: false,
		});
		// Novembro: 1.030.000 − 885.000 (31/10) − 0
		expect(r[3]).toMatchObject({ contributionsCents: 0, yieldCents: 145000 });
		expect(() =>
			monthlyInvestments({ positions: [], movements: [], snapshots: [], today: TODAY, months: 0 }),
		).toThrow(RangeError);
	});
});

describe("evolução", () => {
	const positions = [
		pos("cdb"),
		pos("acao", { type: "EQUITY", subtype: "STOCK" }),
		pos("fora", { currency: "USD" }),
	];

	it("série dos dias com retrato, sem preencher os dias que faltam", () => {
		const series = investmentEvolution({
			positions,
			movements: [mv("acao", "BUY", "2026-11-01", 200000)],
			snapshots: [
				snap("cdb", "2026-11-03", 1000000, 990000),
				snap("acao", "2026-11-03", 210000),
				snap("cdb", "2026-11-07", 1002000, 990000),
				snap("fora", "2026-11-07", 5),
				snap("cdb", "2026-10-01", 1), // fora da faixa
			],
			from: "2026-11-01",
			to: TODAY,
		});
		expect(series).toEqual([
			{
				day: "2026-11-03",
				balanceCents: 1210000,
				investedCents: 1190000,
				investedEstimated: true,
				investedComplete: true,
				positions: 2,
				carriedPositions: 0,
				missingPositions: 0,
			},
			{
				day: "2026-11-07",
				// A ação não sincronizou em 07/11: entra o retrato de 03/11 (4 dias antes).
				balanceCents: 1212000,
				investedCents: 1190000,
				investedEstimated: true,
				investedComplete: true,
				positions: 1,
				carriedPositions: 1,
				missingPositions: 0,
			},
		]);
	});

	it("aplicado desconhecido marca incompleto; posição zerada não conta aplicado", () => {
		const series = investmentEvolution({
			positions: [pos("a"), pos("b")],
			movements: [],
			snapshots: [snap("a", "2026-11-03", 5000), snap("b", "2026-11-03", 0)],
			from: "2026-11-01",
			to: TODAY,
		});
		expect(series[0]).toMatchObject({ balanceCents: 5000, investedCents: 0, investedComplete: false });
	});

	it("faixa: 1m, 6m e 1y a partir de hoje (dia 31 cai no último dia do mês curto)", () => {
		expect(evolutionRangeStart("1m", TODAY)).toBe("2026-10-15");
		expect(evolutionRangeStart("6m", TODAY)).toBe("2026-05-15");
		expect(evolutionRangeStart("1y", TODAY)).toBe("2025-11-15");
		expect(evolutionRangeStart("1m", "2026-03-31")).toBe("2026-02-28");
	});
});

describe("patrimônio e quebras", () => {
	const positions = [
		pos("cdb", { balanceCents: 600000 }),
		pos("tesouro", {
			subtype: "TREASURY",
			balanceCents: 200000,
			institutionKey: "item-b",
			institutionLabel: "Banco B",
		}),
		pos("acao", {
			type: "EQUITY",
			subtype: "STOCK",
			balanceCents: 100000,
			institutionKey: "item-b",
			institutionLabel: "Banco B",
		}),
		pos("fundo", { type: "MUTUAL_FUND", subtype: "INVESTMENT_FUND", balanceCents: 100000 }),
		pos("zerado", { status: "TOTAL_WITHDRAWAL", balanceCents: 0 }),
		pos("arquivado", { archived: true, balanceCents: 123456 }),
		pos("semsaldo", { balanceCents: null }),
		pos("usd", { currency: "USD", balanceCents: 4242 }),
	];

	it("patrimônio = soma dos saldos das ativas em reais; contagens do que ficou de fora", () => {
		const b = portfolioBreakdown(positions);
		expect(b.totalCents).toBe(1000000);
		expect(b).toMatchObject({ activePositions: 5, withoutBalance: 1, foreignCurrency: 1 });
	});

	it("por classe (Tesouro dentro de renda fixa) e por instituição, com participação que fecha em 100%", () => {
		const b = portfolioBreakdown(positions);
		expect(b.byClass.map((g) => [g.class, g.label, g.balanceCents, g.shareBps, g.positions])).toEqual([
			["fixed_income", "Renda fixa", 800000, 8000, 2],
			["equity", "Ações", 100000, 1000, 1],
			["fund", "Fundos", 100000, 1000, 1],
		]);
		expect(b.byInstitution.map((g) => [g.key, g.label, g.balanceCents, g.shareBps])).toEqual([
			["item-a", "Banco A", 700000, 7000],
			["item-b", "Banco B", 300000, 3000],
		]);
	});

	it("carteira vazia: total zero, sem grupos", () => {
		expect(portfolioBreakdown([])).toEqual({
			totalCents: 0,
			activePositions: 0,
			withoutBalance: 0,
			foreignCurrency: 0,
			byClass: [],
			byInstitution: [],
		});
	});

	it("participação: maior resto, sempre 10000", () => {
		expect(shareBasisPoints([1, 1, 1])).toEqual([3334, 3333, 3333]);
		expect(shareBasisPoints([0, 0])).toEqual([0, 0]);
		const s = shareBasisPoints([333, 333, 334, 1]);
		expect(s.reduce((a, b) => a + b, 0)).toBe(10000);
	});

	it("divisão arredondada, sem float", () => {
		expect(roundedDiv(5, 2)).toBe(3);
		expect(roundedDiv(-5, 2)).toBe(-3);
		expect(roundedDiv(1, 3)).toBe(0);
		expect(roundedDiv(2, 3)).toBe(1);
		expect(() => roundedDiv(1, 0)).toThrow(RangeError);
	});
});

describe("revisão: números que não podem sair errados e exatos", () => {
	it("resgate parcial: não vira perda falsa exata (aplicado − resgates, estimado, com motivo)", () => {
		const movements = [mv("a", "BUY", "2026-01-10", 1000000), mv("a", "SELL", "2026-06-10", 500000)];
		const y = positionYield(pos("a", { balanceCents: 520000, investedCents: 1000000 }), movements);
		expect(y).toMatchObject({ cents: 20000, estimated: true, basis: "invested", basisCents: 500000 });
		expect(y.reason).toContain("resgate parcial");
		// Resgates maiores que o aplicado: não faz sentido, sem número.
		const nonsense = positionYield(pos("a", { balanceCents: 1000, investedCents: 1000000 }), [
			mv("a", "SELL", "2026-06-10", 1200000),
		]);
		expect(nonsense).toMatchObject({ cents: null, basis: "unavailable" });
		// Sem resgate continua exato.
		expect(positionYield(pos("a", { balanceCents: 1020000, investedCents: 1000000 }), []).estimated).toBe(
			false,
		);
	});

	it("valor de movimentação negativo na fonte: a magnitude vale, o sentido vem de BUY/SELL", () => {
		const movements = [mv("a", "BUY", "2026-01-10", -1000000), mv("a", "SELL", "2026-06-10", -500000)];
		const y = positionYield(pos("a", { balanceCents: 520000, investedCents: 1000000 }), movements);
		expect(y.cents).toBe(20000);
		const stock = positionYield(pos("s", { type: "EQUITY", balanceCents: 140000 }), [
			mv("s", "BUY", "2026-01-10", 150000),
			mv("s", "SELL", "2026-03-10", -30000),
		]);
		expect(stock.cents).toBe(20000);
	});

	it("posição encerrada: nunca mostra −aplicado exato; realizado só com movimentações completas, estimado", () => {
		const closed = pos("z", {
			status: "TOTAL_WITHDRAWAL",
			archived: true,
			balanceCents: 0,
			investedCents: 100000,
		});
		const movements = [mv("z", "BUY", "2026-01-10", 100000), mv("z", "SELL", "2026-09-30", 105000)];
		expect(positionYield({ ...closed, movementsComplete: true }, movements)).toMatchObject({
			cents: 5000,
			estimated: true,
			basis: "movements",
		});
		const unknown = positionYield(closed, movements);
		expect(unknown).toMatchObject({ cents: null, basis: "unavailable" });
		expect(unknown.reason).toContain("encerrada");
	});

	it("mês: fechamento sem o SELL nas movimentações deixa a posição de fora (não é perda)", () => {
		const r = monthYield({
			positions: [pos("cdb", { status: "TOTAL_WITHDRAWAL", archived: true, balanceCents: 0 })],
			movements: [],
			snapshots: [snap("cdb", "2026-10-31", 1000000), snap("cdb", "2026-11-04", 0)],
			month: "2026-11",
			today: TODAY,
		});
		expect(r).toMatchObject({ cents: null, countedPositions: 0, missingPositions: 1 });
		expect(r.reason).toContain("resgate");
	});

	it("mês: posição antiga com histórico de movimentações de só 1 ano não parte de zero sem evidência", () => {
		const old = pos("acao", { type: "EQUITY", subtype: "STOCK", balanceCents: 500000 });
		const base = {
			positions: [old],
			movements: [mv("acao", "BUY", "2026-11-03", 10000)],
			snapshots: [snap("acao", "2026-11-12", 500000)],
			month: "2026-11",
			today: TODAY,
		};
		expect(monthYield(base)).toMatchObject({ cents: null, reason: NO_HISTORY_REASON });
		// Evidência: data de compra no mês.
		const bought = monthYield({ ...base, positions: [{ ...old, purchaseDate: "2026-11-03" }] });
		expect(bought.cents).toBe(500000 - 10000);
		// Data de compra antiga contradiz a abertura, mesmo com movimentação no mês.
		expect(monthYield({ ...base, positions: [{ ...old, purchaseDate: "2020-01-05" }] }).cents).toBeNull();
		// Sem data, saldo coerente com compras − vendas (±20%) também vale.
		const coherent = monthYield({ ...base, positions: [{ ...old, balanceCents: 10200 }] });
		expect(coherent.cents).toBe(200);
	});

	it("mês: aporte no último dia do mês (dia do retrato de partida) entra no período, sem inflar o rendimento", () => {
		const r = monthYield({
			positions: [pos("cdb", { balanceCents: 1060000 })],
			movements: [mv("cdb", "BUY", "2026-10-31", 50000)],
			snapshots: [snap("cdb", "2026-10-31", 1000000)],
			month: "2026-11",
			today: TODAY,
		});
		// O retrato de um dia vale como o saldo de ANTES das movimentações daquele dia.
		expect(r.cents).toBe(10000);
		// Movimentação de hoje ainda não está no saldo lido: não conta.
		const today = monthYield({
			positions: [pos("cdb", { balanceCents: 1010000 })],
			movements: [mv("cdb", "BUY", TODAY, 50000)],
			snapshots: [snap("cdb", "2026-10-31", 1000000)],
			month: "2026-11",
			today: TODAY,
		});
		expect(today.cents).toBe(10000);
	});

	it("evolução: dia em que uma posição não sincronizou carrega o último retrato (até 5 dias) e expõe quem faltou", () => {
		const series = investmentEvolution({
			positions: [pos("a"), pos("b")],
			movements: [],
			snapshots: [
				snap("a", "2026-11-01", 1000, 900),
				snap("b", "2026-11-01", 500, 400),
				snap("a", "2026-11-04", 1100, 900),
				snap("a", "2026-11-09", 1200, 900),
			],
			from: "2026-11-01",
			to: TODAY,
		});
		expect(series[1]).toMatchObject({
			day: "2026-11-04",
			balanceCents: 1600,
			positions: 1,
			carriedPositions: 1,
			missingPositions: 0,
		});
		// Dia 9: b está 8 dias defasada: fora da soma e contada.
		expect(series[2]).toMatchObject({
			day: "2026-11-09",
			balanceCents: 1200,
			carriedPositions: 0,
			missingPositions: 1,
		});
		expect(series[0]).toMatchObject({ carriedPositions: 0, missingPositions: 0 });
	});

	it("saldo negativo: fora do total e dos grupos (total = soma dos grupos)", () => {
		const b = portfolioBreakdown([pos("a", { balanceCents: 1000 }), pos("neg", { balanceCents: -300 })]);
		expect(b.totalCents).toBe(1000);
		expect(b.byClass.reduce((s, g) => s + g.balanceCents, 0)).toBe(b.totalCents);
		expect(b.withoutBalance).toBe(1);
	});
});
