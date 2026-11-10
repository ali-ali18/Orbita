import { describe, expect, it } from "vitest";
import {
	classifyFee,
	findSavingsOpportunities,
	type SavingsInput,
	type SavingsOpportunity,
	type SavingsSpend,
} from "./savings.ts";

const TODAY = "2026-11-09";
let n = 0;
const spend = (
	date: string,
	amountCents: number,
	merchant: string,
	extra: Partial<SavingsSpend> = {},
): SavingsSpend => ({ id: `t${++n}`, date, amountCents, categoryId: null, merchant, ...extra });

/** Uma cobrança por mês, no mesmo dia, começando em `start` (AAAA-MM-DD). */
const monthlyCharges = (
	merchant: string,
	amounts: number[],
	start: string,
	extra: Partial<SavingsSpend> = {},
) =>
	amounts.map((amount, i) => {
		const [y, m, d] = start.split("-").map(Number) as [number, number, number];
		const month = m + i;
		const date = `${y + Math.floor((month - 1) / 12)}-${String(((month - 1) % 12) + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
		return spend(date, amount, merchant, extra);
	});

const base = (over: Partial<SavingsInput> = {}): SavingsInput => ({
	today: TODAY,
	spends: [],
	subscriptions: [],
	postedIds: new Set(),
	incomeCents: null,
	totalBudgetCents: null,
	projectedCents: null,
	projectionLowConfidence: false,
	installments: { committedCents: 0, transactionIds: [], groupCount: 0 },
	invoices: [],
	balanceCents: null,
	...over,
});

const ofType = <T extends SavingsOpportunity["type"]>(input: SavingsInput, type: T) =>
	findSavingsOpportunities(input).opportunities.filter(
		(o): o is Extract<SavingsOpportunity, { type: T }> => o.type === type,
	);

describe("assinaturas duplicadas ou sobrepostas", () => {
	const sub = (id: string, name: string, amountCents: number) => ({
		id,
		name,
		amountCents,
		remindDayBefore: true,
	});

	it("dois serviços de música cadastrados: a economia garantida é a do mais barato", () => {
		const [o] = ofType(
			base({ subscriptions: [sub("r1", "Spotify", 2190), sub("r2", "Deezer", 1790)] }),
			"duplicate_subscription",
		);
		expect(o?.detail.group).toBe("music");
		expect(o?.monthlySavingsCents).toBe(1790);
		expect(o?.confidence).toBe("high");
		expect(o?.evidence.subscriptionIds).toEqual(["r2", "r1"]);
	});

	it("dois serviços de IA, um cadastrado e outro só detectado nas cobranças: confiança média e evidência da cobrança", () => {
		const charges = monthlyCharges("OPENAI *CHATGPT SUBSCR", [10000, 10000, 10000], "2026-08-20");
		const [o] = ofType(
			base({ subscriptions: [sub("r1", "Claude", 11000)], spends: charges }),
			"duplicate_subscription",
		);
		expect(o?.detail.group).toBe("ai");
		expect(o?.confidence).toBe("medium");
		expect(o?.monthlySavingsCents).toBe(10000);
		expect(o?.evidence.transactionIds).toEqual([charges[2]?.id]);
		expect(o?.evidence.subscriptionIds).toEqual(["r1"]);
	});

	it("falso positivo: Spotify e Netflix (categorias diferentes) não são duplicadas", () => {
		const found = ofType(
			base({ subscriptions: [sub("r1", "Spotify", 2190), sub("r2", "Netflix", 4490)] }),
			"duplicate_subscription",
		);
		expect(found).toEqual([]);
	});

	it("falso positivo: YouTube + Spotify não conta (YouTube junta vídeo e música)", () => {
		const found = ofType(
			base({ subscriptions: [sub("r1", "YouTube Premium", 2490), sub("r2", "Spotify", 2190)] }),
			"duplicate_subscription",
		);
		expect(found).toEqual([]);
	});

	it("dois streamings de vídeo não bastam; três entram com confiança baixa", () => {
		const two = [sub("a", "Netflix", 4490), sub("b", "Disney+", 3390)];
		expect(ofType(base({ subscriptions: two }), "duplicate_subscription")).toEqual([]);
		const [three] = ofType(
			base({ subscriptions: [...two, sub("c", "HBO Max", 3490)] }),
			"duplicate_subscription",
		);
		expect(three?.detail.group).toBe("video");
		expect(three?.confidence).toBe("low");
		expect(three?.monthlySavingsCents).toBe(3390);
	});

	it("o mesmo serviço conhecido cadastrado duas vezes (dois planos)", () => {
		const [o] = ofType(
			base({ subscriptions: [sub("a", "Netflix", 4490), sub("b", "Netflix Extra", 1990)] }),
			"duplicate_subscription",
		);
		expect(o?.detail.group).toBe("same");
		expect(o?.monthlySavingsCents).toBe(1990);
	});
});

describe("assinatura que subiu de preço", () => {
	it("a cobrança recente passou do cadastrado: a economia é o aumento", () => {
		const recent = spend("2026-11-05", 5590, "NETFLIX.COM");
		const [o] = ofType(
			base({
				subscriptions: [{ id: "r1", name: "Netflix", amountCents: 4490, remindDayBefore: false }],
				spends: [recent],
			}),
			"price_increase",
		);
		expect(o).toMatchObject({ monthlySavingsCents: 1100, confidence: "high" });
		expect(o?.evidence).toEqual({ transactionIds: [recent.id], subscriptionIds: ["r1"] });
	});

	it("falso positivo: centavos de arredondamento e lançamento que veio da própria recorrência", () => {
		const posted = spend("2026-11-05", 6000, "NETFLIX.COM");
		const input = base({
			subscriptions: [{ id: "r1", name: "Netflix", amountCents: 4490, remindDayBefore: false }],
			spends: [spend("2026-11-04", 4500, "NETFLIX.COM"), posted],
			postedIds: new Set([posted.id]),
		});
		expect(ofType(input, "price_increase")).toEqual([]);
	});
});

describe("categoria acima da média dos 3 meses", () => {
	const mercadoMonths = (amounts: [number, number, number]) => [
		spend("2026-08-10", amounts[0], "Mercado A", { categoryId: "lazer", categorySlug: "lazer" }),
		spend("2026-09-10", amounts[1], "Mercado B", { categoryId: "lazer", categorySlug: "lazer" }),
		spend("2026-10-10", amounts[2], "Mercado C", { categoryId: "lazer", categorySlug: "lazer" }),
	];

	it("o mês corrente já passou da média: valor e percentual saem do engine", () => {
		const current = spend("2026-11-03", 45000, "Cinema", { categoryId: "lazer", categorySlug: "lazer" });
		const [o] = ofType(
			base({ spends: [...mercadoMonths([30000, 30000, 30000]), current] }),
			"category_above_average",
		);
		expect(o?.detail).toMatchObject({
			categoryId: "lazer",
			spentCents: 45000,
			averageCents: 30000,
			excessCents: 15000,
			percentAbove: 50,
			monthsUsed: 3,
			suggestedLimitCents: 30000,
		});
		expect(o?.monthlySavingsCents).toBe(15000);
		expect(o?.countsInTotal).toBe(false);
		expect(o?.evidence.transactionIds).toEqual([current.id]);
	});

	it("falso positivo: gasto dentro da média, ou acima por menos de 20 % / R$ 50", () => {
		const within = spend("2026-11-03", 31000, "Cinema", { categoryId: "lazer", categorySlug: "lazer" });
		expect(
			ofType(base({ spends: [...mercadoMonths([30000, 30000, 30000]), within] }), "category_above_average"),
		).toEqual([]);
		const small = spend("2026-11-03", 12000, "Cinema", { categoryId: "lazer", categorySlug: "lazer" });
		expect(
			ofType(base({ spends: [...mercadoMonths([8000, 8000, 8000]), small] }), "category_above_average"),
		).toEqual([]);
	});

	it("falso positivo: categoria nova (sem 2 meses de histórico) e moradia", () => {
		const current = spend("2026-11-03", 90000, "Loja", { categoryId: "nova", categorySlug: "lazer" });
		const old = spend("2026-10-03", 10000, "Loja", { categoryId: "nova", categorySlug: "lazer" });
		const filler = spend("2026-09-03", 1000, "Outra", { categoryId: "x", categorySlug: "lazer" });
		expect(ofType(base({ spends: [old, filler, current] }), "category_above_average")).toEqual([]);
		const rent = [
			spend("2026-08-05", 100000, "Aluguel", { categoryId: "mor", categorySlug: "moradia" }),
			spend("2026-09-05", 100000, "Aluguel", { categoryId: "mor", categorySlug: "moradia" }),
			spend("2026-10-05", 100000, "Aluguel", { categoryId: "mor", categorySlug: "moradia" }),
			spend("2026-11-05", 190000, "Aluguel + reajuste", { categoryId: "mor", categorySlug: "moradia" }),
		];
		expect(ofType(base({ spends: rent }), "category_above_average")).toEqual([]);
	});

	it("falso positivo: 'Outros' é um balaio, não um hábito: nunca aparece como acima da média", () => {
		const outros = (date: string, cents: number) =>
			spend(date, cents, "Diversos", { categoryId: "outros", categorySlug: "outros" });
		const spends = [
			outros("2026-08-10", 10000),
			outros("2026-09-10", 10000),
			outros("2026-10-10", 10000),
			outros("2026-11-03", 90000),
		];
		expect(ofType(base({ spends }), "category_above_average")).toEqual([]);
	});

	it("com só 2 meses de dados a confiança cai para média", () => {
		const current = spend("2026-11-03", 45000, "Cinema", { categoryId: "lazer", categorySlug: "lazer" });
		const two = mercadoMonths([30000, 30000, 30000]).slice(1);
		const [o] = ofType(base({ spends: [...two, current] }), "category_above_average");
		expect(o?.confidence).toBe("medium");
		expect(o?.detail.monthsUsed).toBe(2);
	});
});

describe("taxas, IOF, juros e anuidade", () => {
	it("classifica pelo texto e ignora o que só parece tarifa", () => {
		expect(classifyFee("JUROS DE MORA")).toBe("interest");
		expect(classifyFee("Encargos rotativo")).toBe("interest");
		expect(classifyFee("MULTA POR ATRASO FATURA")).toBe("interest");
		expect(classifyFee("IOF COMPRA INTERNACIONAL")).toBe("iof");
		expect(classifyFee("ANUIDADE DIFERENCIADA 03/12")).toBe("annuity");
		expect(classifyFee("Tarifa bancária pacote")).toBe("bank_fee");
		expect(classifyFee("Cesta de serviços")).toBe("bank_fee");
		expect(classifyFee("MULTA DE TRANSITO DETRAN")).toBeNull();
		expect(classifyFee("Tarifa de ônibus")).toBeNull();
		expect(classifyFee("Iofi Restaurante")).toBeNull();
		expect(classifyFee(null)).toBeNull();
	});

	it("soma por tipo nos últimos 90 dias e estima por mês", () => {
		const iof = [spend("2026-09-20", 450, "IOF"), spend("2026-10-18", 900, "IOF COMPRA EXTERIOR")];
		const juros = spend("2026-11-01", 3000, "JUROS DE MORA");
		const found = ofType(base({ spends: [...iof, juros] }), "fees");
		const kinds = Object.fromEntries(found.map((f) => [f.detail.feeKind, f]));
		expect(kinds.interest).toMatchObject({ monthlySavingsCents: 1000, confidence: "high" });
		expect(kinds.interest?.detail).toMatchObject({ totalCents: 3000, count: 1 });
		expect(kinds.iof).toMatchObject({ monthlySavingsCents: 450, confidence: "medium" });
		expect(kinds.iof?.evidence.transactionIds).toHaveLength(2);
	});

	it("anuidade de uma vez só vale um doze avos; fora da janela ou parcelada não entra", () => {
		const annual = spend("2026-10-01", 60000, "ANUIDADE CARTAO");
		expect(ofType(base({ spends: [annual] }), "fees")[0]?.monthlySavingsCents).toBe(5000);
		const old = spend("2026-06-01", 60000, "ANUIDADE CARTAO");
		expect(ofType(base({ spends: [old] }), "fees")).toEqual([]);
		const parceled = spend("2026-10-01", 60000, "IOF", { installmentGroupId: "g1" });
		expect(ofType(base({ spends: [parceled] }), "fees")).toEqual([]);
	});

	it("abaixo de R$ 5 não vale aviso", () => {
		expect(ofType(base({ spends: [spend("2026-11-01", 300, "IOF")] }), "fees")).toEqual([]);
	});
});

describe("compras recorrentes pequenas que somam muito", () => {
	const visits = (merchant: string, days: string[], cents: number, extra: Partial<SavingsSpend> = {}) =>
		days.map((d) => spend(`2026-10-${d}`, cents, merchant, extra));

	it("o mesmo estabelecimento 6 vezes em 30 dias, cada uma pequena: corta um quarto", () => {
		const list = visits("Padaria Estrela", ["12", "15", "19", "22", "26", "30"], 2500, {
			categoryId: "outros",
			categorySlug: "outros",
		});
		const [o] = ofType(base({ spends: list }), "small_recurring");
		expect(o?.detail).toMatchObject({ count: 6, totalCents: 15000, averageCents: 2500, cutPercent: 25 });
		expect(o?.monthlySavingsCents).toBe(3750);
		expect(o?.confidence).toBe("low");
		expect(o?.evidence.transactionIds).toHaveLength(6);
	});

	it("falso positivo: poucas idas, soma baixa, compra grande, essencial ou assinatura", () => {
		const few = visits("Padaria", ["12", "15", "19", "22"], 4000);
		expect(ofType(base({ spends: few }), "small_recurring")).toEqual([]);
		const cheap = visits("Banca", ["12", "15", "19", "22", "26", "30"], 1000);
		expect(ofType(base({ spends: cheap }), "small_recurring")).toEqual([]);
		const big = visits("Restaurante", ["12", "15", "19", "22", "26", "30"], 9000);
		expect(ofType(base({ spends: big }), "small_recurring")).toEqual([]);
		const market = visits("Supermercado Bom", ["12", "15", "19", "22", "26", "30"], 3000, {
			categorySlug: "mercado",
		});
		expect(ofType(base({ spends: market }), "small_recurring")).toEqual([]);
		const sameDay = visits("Padaria", ["12", "12", "12", "12", "12", "12"], 3000);
		expect(ofType(base({ spends: sameDay }), "small_recurring")).toEqual([]);
	});

	it("uma assinatura mensal não é compra recorrente pequena", () => {
		const list = monthlyCharges("SPOTIFY", [2190, 2190, 2190, 2190], "2026-08-05");
		expect(ofType(base({ spends: list }), "small_recurring")).toEqual([]);
	});
});

describe("parcelamentos, projeção e fatura", () => {
	it("parcelas acima de 30 % da renda: percentual e alívio do engine, fora do total", () => {
		const input = base({
			incomeCents: 500000,
			installments: { committedCents: 200000, transactionIds: ["p1", "p2"], groupCount: 2 },
		});
		const [o] = ofType(input, "installments_load");
		expect(o?.detail).toMatchObject({ percent: 40, thresholdPercent: 30, groupCount: 2 });
		expect(o?.monthlySavingsCents).toBe(50000);
		expect(o?.countsInTotal).toBe(false);
		expect(findSavingsOpportunities(input).totalMonthlySavingsCents).toBe(0);
	});

	it("falso positivo: exatamente 30 %, sem renda, sem parcela", () => {
		const at30 = base({
			incomeCents: 500000,
			installments: { committedCents: 150000, transactionIds: [], groupCount: 1 },
		});
		expect(ofType(at30, "installments_load")).toEqual([]);
		const noIncome = base({ installments: { committedCents: 150000, transactionIds: [], groupCount: 1 } });
		expect(ofType(noIncome, "installments_load")).toEqual([]);
	});

	it("projeção acima do orçamento (o menor dos limites), com confiança baixa no começo do mês", () => {
		const [o] = ofType(
			base({
				projectedCents: 620000,
				totalBudgetCents: 500000,
				incomeCents: 600000,
				projectionLowConfidence: true,
			}),
			"projected_over",
		);
		expect(o?.detail).toMatchObject({ reference: "budget", referenceCents: 500000, excessCents: 120000 });
		expect(o?.confidence).toBe("low");
		const [income] = ofType(base({ projectedCents: 620000, incomeCents: 600000 }), "projected_over");
		expect(income?.detail.reference).toBe("income");
		expect(income?.confidence).toBe("medium");
	});

	it("falso positivo: projeção dentro do limite, ou sobra de menos de R$ 50, ou sem projeção", () => {
		expect(ofType(base({ projectedCents: 480000, totalBudgetCents: 500000 }), "projected_over")).toEqual([]);
		expect(ofType(base({ projectedCents: 502000, totalBudgetCents: 500000 }), "projected_over")).toEqual([]);
		expect(ofType(base({ totalBudgetCents: 500000 }), "projected_over")).toEqual([]);
	});

	it("fatura a vencer maior que o saldo: o que falta; sem saldo lido não afirma nada", () => {
		const invoices = [
			{ cardId: "c1", cardName: "Nubank", dueDate: "2026-11-12", owedCents: 180000 },
			{ cardId: "c2", cardName: "Inter", dueDate: "2026-11-15", owedCents: 90000 },
			{ cardId: "c3", cardName: "Itaú", dueDate: "2026-12-20", owedCents: 500000 },
		];
		const [o] = ofType(base({ invoices, balanceCents: 200000 }), "invoice_unfunded");
		expect(o?.detail).toMatchObject({
			owedCents: 270000,
			balanceCents: 200000,
			shortfallCents: 70000,
			dueDate: "2026-11-12",
		});
		expect(o?.detail.cards).toHaveLength(2);
		expect(o?.monthlySavingsCents).toBe(0);
		expect(ofType(base({ invoices, balanceCents: null }), "invoice_unfunded")).toEqual([]);
		expect(ofType(base({ invoices, balanceCents: 300000 }), "invoice_unfunded")).toEqual([]);
		// Vencida ou longe demais não entra.
		expect(
			ofType(
				base({
					invoices: [{ cardId: "c", cardName: "X", dueDate: "2026-11-01", owedCents: 99999 }],
					balanceCents: 0,
				}),
				"invoice_unfunded",
			),
		).toEqual([]);
	});
});

describe("o conjunto", () => {
	it("o total só soma o que não se sobrepõe e os cortes que somam vêm antes do contexto", () => {
		const subs = [
			{ id: "r1", name: "Spotify", amountCents: 2190, remindDayBefore: true },
			{ id: "r2", name: "Deezer", amountCents: 1790, remindDayBefore: true },
		];
		const result = findSavingsOpportunities(
			base({
				subscriptions: subs,
				spends: [spend("2026-11-01", 3000, "JUROS DE MORA")],
				projectedCents: 700000,
				totalBudgetCents: 500000,
			}),
		);
		expect(result.opportunities.map((o) => o.type)).toEqual([
			"duplicate_subscription",
			"fees",
			"projected_over",
		]);
		// juros 1000 (3000/3) + duplicada 1790; a projeção não entra.
		expect(result.totalMonthlySavingsCents).toBe(2790);
	});

	it("nunca inventa 'assinatura sem uso': só existem os tipos que os lançamentos sustentam", () => {
		const result = findSavingsOpportunities(
			base({ subscriptions: [{ id: "r", name: "Spotify", amountCents: 2190, remindDayBefore: true }] }),
		);
		expect(result.opportunities).toEqual([]);
	});

	it("é determinístico e as chaves são estáveis", () => {
		const input = base({ spends: [spend("2026-11-01", 3000, "JUROS DE MORA")] });
		expect(findSavingsOpportunities(input)).toEqual(findSavingsOpportunities(input));
		expect(findSavingsOpportunities(input).opportunities[0]?.key).toBe("fees:interest:2026-11");
	});

	it("recusa valor que não é inteiro", () => {
		expect(() => findSavingsOpportunities(base({ spends: [spend("2026-11-01", 10.5, "IOF")] }))).toThrow();
	});
});
