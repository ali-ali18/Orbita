import { describe, expect, it } from "vitest";
import { analyzeHistory, type SetupAnalysisInput, type SetupTransaction } from "./setup-analysis.ts";

const TODAY = "2026-11-12";
const CATEGORIES = [
	{ id: "c-ass", slug: "assinaturas" },
	{ id: "c-del", slug: "delivery" },
	{ id: "c-mer", slug: "mercado" },
	{ id: "c-out", slug: "outros" },
];

let n = 0;
function tx(
	over: Partial<SetupTransaction> & Pick<SetupTransaction, "date" | "amountCents">,
): SetupTransaction {
	n += 1;
	return {
		id: `t${n}`,
		kind: "expense",
		description: "Compra",
		merchantName: null,
		categoryId: "c-out",
		accountId: null,
		cardId: "card-1",
		installment: false,
		...over,
	};
}

/** Uma cobrança por mês, no dia `day`, a partir de `start` (AAAA-MM). */
function monthly(
	description: string,
	cents: number[],
	start: string,
	day: number,
	over: Partial<SetupTransaction> = {},
): SetupTransaction[] {
	const [y, m] = start.split("-").map(Number) as [number, number];
	return cents.map((amountCents, i) => {
		const month = m + i;
		const year = y + Math.floor((month - 1) / 12);
		const mm = ((month - 1) % 12) + 1;
		return tx({
			date: `${year}-${String(mm).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
			amountCents,
			description,
			...over,
		});
	});
}

const base = (
	transactions: SetupTransaction[],
	over: Partial<SetupAnalysisInput> = {},
): SetupAnalysisInput => ({
	transactions,
	today: TODAY,
	registeredNames: [],
	hasIncome: false,
	categories: CATEGORIES,
	rules: [],
	...over,
});

describe("analyzeHistory: cobranças mensais", () => {
	it("acha a mensalidade com a mediana, o dia usual e o cartão, e propõe começar no mês seguinte à última", () => {
		const txs = monthly("UNIP*MENSALIDADE 0423", [48000, 48000, 49000, 48000], "2026-07", 8);
		const { recurring } = analyzeHistory(base(txs));
		expect(recurring).toHaveLength(1);
		expect(recurring[0]).toMatchObject({
			key: "rec:unip",
			merchant: "UNIP*MENSALIDADE 0423",
			amountCents: 48000,
			dayOfMonth: 8,
			occurrences: 4,
			firstDate: "2026-07-08",
			lastDate: "2026-10-08",
			startDate: "2026-11-01",
			cardId: "card-1",
			accountId: null,
			registered: false,
			knownService: null,
		});
	});

	it("serviço conhecido vale com duas cobranças e sugere a categoria do catálogo; desconhecido pede três", () => {
		const txs = [
			...monthly("NETFLIX.COM", [4490, 4490], "2026-09", 10),
			...monthly("Academia Foco", [8900, 8900], "2026-09", 10),
		];
		const { recurring } = analyzeHistory(base(txs));
		expect(recurring.map((r) => [r.key, r.knownService, r.categoryId])).toEqual([
			["rec:netflix", "Netflix", "c-ass"],
		]);
	});

	it("a categoria sai da regra do dono, depois do banco, depois do catálogo", () => {
		const bank = monthly("Clube do Vinho", [9000, 9000, 9000], "2026-08", 5, { categoryId: "c-mer" });
		const found = analyzeHistory(base(bank)).recurring[0];
		expect(found?.categoryId).toBe("c-mer");
		const withRule = analyzeHistory(
			base(bank, { rules: [{ pattern: "clube do vinho", categoryId: "c-del" }] }),
		);
		expect(withRule.recurring[0]?.categoryId).toBe("c-del");
		const none = monthly("Clube do Vinho", [9000, 9000, 9000], "2026-08", 5);
		expect(analyzeHistory(base(none)).recurring[0]?.categoryId).toBeNull();
	});

	it("marca como cadastrada a assinatura que já existe (pela marca) e a deixa por último", () => {
		const txs = [
			...monthly("Spotify AB", [2190, 2190, 2190], "2026-08", 3),
			...monthly("Seguro Casa", [15000, 15000, 15000], "2026-08", 20),
		];
		const { recurring } = analyzeHistory(base(txs, { registeredNames: ["Spotify"] }));
		expect(recurring.map((r) => [r.key, r.registered])).toEqual([
			["rec:seguro", false],
			["rec:spotify", true],
		]);
	});

	it("parcela, lançamento de recorrência, valor que varia e cobrança parada não contam", () => {
		const parcela = monthly("Loja Parcelada", [12000, 12000, 12000], "2026-08", 7, { installment: true });
		const fromRecurrence = monthly("Aluguel", [100000, 100000, 100000], "2026-08", 5);
		const jumpy = monthly("Loja X", [1000, 1000, 5000], "2026-08", 9);
		const stopped = monthly("Revista", [2990, 2990, 2990], "2026-04", 9);
		const { recurring } = analyzeHistory(
			base([...parcela, ...fromRecurrence, ...jumpy, ...stopped], {
				recurringTransactionIds: new Set(fromRecurrence.map((t) => t.id)),
			}),
		);
		expect(recurring).toEqual([]);
	});

	it("usa o nome que o banco informou no lugar da descrição com prefixo", () => {
		const txs = monthly("Compra no débito - ASSINATURA", [3000, 3000, 3000], "2026-08", 15, {
			merchantName: "Clube Leitura",
		});
		expect(analyzeHistory(base(txs)).recurring[0]).toMatchObject({
			key: "rec:clube",
			merchant: "Clube Leitura",
		});
	});
});

describe("analyzeHistory: sem categoria", () => {
	it("agrupa por estabelecimento normalizado, com contagem e total, e ignora o que já tem categoria", () => {
		const txs = [
			tx({ date: "2026-10-02", amountCents: 3000, description: "PADARIA SAO JOSE 1234" }),
			tx({ date: "2026-10-20", amountCents: 2500, description: "Padaria São José" }),
			tx({ date: "2026-11-03", amountCents: 1500, description: "padaria sao jose", categoryId: null }),
			tx({ date: "2026-11-04", amountCents: 9999, description: "Mercado Bom", categoryId: "c-mer" }),
			tx({ date: "2026-11-05", amountCents: 4000, description: "Loja Única" }),
		];
		const { categoryCandidates } = analyzeHistory(base(txs));
		expect(categoryCandidates).toEqual([
			{
				key: "cat:padaria sao jose",
				pattern: "padaria sao jose",
				merchant: expect.any(String),
				count: 3,
				totalCents: 7000,
				lastDate: "2026-11-03",
				categoryId: null,
			},
		]);
	});

	it("não repete o que uma regra do dono já cobre e sugere categoria para serviço conhecido", () => {
		const txs = [
			...[1, 2, 3].map((d) => tx({ date: `2026-10-0${d}`, amountCents: 5000, description: "Rotina X" })),
			...[1, 2].map((d) => tx({ date: `2026-10-1${d}`, amountCents: 4000, description: "IFOOD *PEDIDO" })),
		];
		const { categoryCandidates } = analyzeHistory(
			base(txs, { rules: [{ pattern: "rotina x", categoryId: "c-mer" }] }),
		);
		expect(categoryCandidates.map((c) => [c.pattern, c.categoryId])).toEqual([["ifood pedido", "c-del"]]);
	});

	it("ordena pelo total, do maior para o menor", () => {
		const txs = [
			...[1, 2].map((d) => tx({ date: `2026-10-0${d}`, amountCents: 100, description: "Banca Pequena" })),
			...[1, 2].map((d) => tx({ date: `2026-10-1${d}`, amountCents: 9000, description: "Oficina Grande" })),
		];
		expect(analyzeHistory(base(txs)).categoryCandidates.map((c) => c.pattern)).toEqual([
			"oficina grande",
			"banca pequena",
		]);
	});
});

describe("analyzeHistory: salário", () => {
	const salary = (over: Partial<SetupTransaction> = {}) =>
		monthly("PIX RECEBIDO ACME LTDA", [500000, 500000, 505000], "2026-08", 5, {
			kind: "income",
			cardId: null,
			accountId: "acc-1",
			categoryId: null,
			...over,
		});

	it("acha o crédito mensal parecido do mesmo pagador", () => {
		const { income } = analyzeHistory(base(salary()));
		expect(income).toMatchObject({
			key: "inc:acme ltda",
			payer: "PIX RECEBIDO ACME LTDA",
			amountCents: 500000,
			payday: 5,
			occurrences: 3,
			accountId: "acc-1",
		});
	});

	it("não propõe quando o dono já tem renda, nem com pagadores diferentes a cada mês", () => {
		expect(analyzeHistory(base(salary(), { hasIncome: true })).income).toBeNull();
		const mixed = [
			tx({ kind: "income", date: "2026-08-05", amountCents: 500000, description: "Pix recebido João" }),
			tx({ kind: "income", date: "2026-09-05", amountCents: 500000, description: "Pix recebido Maria" }),
			tx({ kind: "income", date: "2026-10-05", amountCents: 500000, description: "Pix recebido Pedro" }),
		];
		expect(analyzeHistory(base(mixed)).income).toBeNull();
	});

	it("com dois créditos ainda não é salário", () => {
		const two = salary().slice(0, 2);
		expect(analyzeHistory(base(two)).income).toBeNull();
	});
});

describe("analyzeHistory: janela", () => {
	it("conta os meses com movimento e avisa quando são menos de 3", () => {
		const few = analyzeHistory(
			base([tx({ date: "2026-10-02", amountCents: 100 }), tx({ date: "2026-11-02", amountCents: 100 })]),
		);
		expect(few).toMatchObject({ monthsOfHistory: 2, limitedHistory: true, transactionCount: 2 });
		const enough = analyzeHistory(base(monthly("Algo", [1, 1, 1], "2026-08", 2)));
		expect(enough).toMatchObject({ monthsOfHistory: 3, limitedHistory: false });
	});

	it("olha até 12 meses para trás e nada do futuro", () => {
		const old = monthly("Antiga", [5000, 5000, 5000], "2025-06", 5);
		const future = tx({ date: "2026-12-01", amountCents: 100 });
		const result = analyzeHistory(base([...old, future]));
		expect(result.from).toBe("2025-12-01");
		expect(result.to).toBe(TODAY);
		expect(result.transactionCount).toBe(0);
	});
});

describe("analyzeHistory: assinaturas do Open Finance (Google, YouTube, câmbio)", () => {
	// Hoje 12/11/2026; 4 meses de histórico (jul a out), como a janela de 122 dias do Pluggy.
	it("separa Google One de YouTube Music mesmo com o nome 'Google' igual e a descrição diferente", () => {
		const txs = [
			...monthly("GOOGLE *Google One", [9690, 9690, 9690, 9690], "2026-07", 5, { merchantName: "Google" }),
			...monthly("GOOGLE*YOUTUBEMUSIC", [2190, 2190, 2190, 2190], "2026-07", 7, { merchantName: "Google" }),
		];
		const { recurring } = analyzeHistory(base(txs));
		expect(recurring.map((r) => [r.key, r.amountCents, r.occurrences, r.knownService])).toEqual([
			["rec:googleone", 9690, 4, "Google One (Gemini)"],
			["rec:youtube", 2190, 4, "YouTube (Premium ou Music)"],
		]);
	});

	it("descrições variadas do mesmo serviço (PAYPAL, DL*, sem prefixo), valor com IOF e dia variando viram uma só", () => {
		const txs = [
			tx({ date: "2026-08-03", amountCents: 9690, description: "GOOGLE *Google One" }),
			tx({ date: "2026-09-05", amountCents: 9980, description: "Google One" }),
			tx({ date: "2026-10-02", amountCents: 9820, description: "PAYPAL *GOOGLE ONE" }),
		];
		const [one] = analyzeHistory(base(txs)).recurring;
		expect(one).toMatchObject({
			key: "rec:googleone",
			occurrences: 3,
			amountCents: 9820,
			lastAmountCents: 9820,
			averageAmountCents: 9830,
		});
		const dl = [
			tx({ date: "2026-09-08", amountCents: 2190, description: "DL*GOOGLE YouTube" }),
			tx({ date: "2026-10-09", amountCents: 2190, description: "DL*GOOGLE YouTube" }),
		];
		expect(analyzeHistory(base(dl)).recurring.map((r) => [r.key, r.occurrences])).toEqual([
			["rec:youtube", 2],
		]);
	});

	it("serviço conhecido vale com 2 ocorrências; desconhecido com 2 não", () => {
		const known = monthly("GOOGLE *Google One", [9690, 9690], "2026-09", 5);
		expect(analyzeHistory(base(known)).recurring).toHaveLength(1);
		const unknown = monthly("ACADEMIA FORMA FISICA", [12000, 12000], "2026-09", 5);
		expect(analyzeHistory(base(unknown)).recurring).toEqual([]);
		const three = monthly("ACADEMIA FORMA FISICA", [12000, 12000, 12000], "2026-08", 5);
		expect(analyzeHistory(base(three)).recurring).toHaveLength(1);
	});

	it("não confunde com assinatura: mercado e Uber com valores diferentes, parcelas e compra solta", () => {
		const txs = [
			...monthly("SUPERMERCADO BH", [23450, 41210, 9870, 30500], "2026-07", 6),
			...monthly("UBER *TRIP", [1890, 3420, 2750, 5100], "2026-07", 9),
			...monthly("MAGAZINE LUIZA", [15990, 15990, 15990, 15990], "2026-07", 10, { installment: true }),
			tx({ date: "2026-10-04", amountCents: 9690, description: "LOJA DO ZE" }),
		];
		expect(analyzeHistory(base(txs)).recurring).toEqual([]);
	});

	it("não vira assinatura: compras de mesmo valor a cada semana (Uber)", () => {
		const txs = [
			tx({ date: "2026-09-02", amountCents: 1890, description: "UBER *TRIP" }),
			tx({ date: "2026-09-09", amountCents: 1890, description: "UBER *TRIP" }),
			tx({ date: "2026-09-16", amountCents: 1890, description: "UBER *TRIP" }),
			tx({ date: "2026-10-14", amountCents: 1890, description: "UBER *TRIP" }),
		];
		expect(analyzeHistory(base(txs)).recurring).toEqual([]);
	});

	it("assinatura em cartões diferentes continua uma só, e a cadastrada sai marcada", () => {
		const txs = [
			tx({ date: "2026-08-05", amountCents: 3190, description: "SPOTIFY", cardId: "card-1" }),
			tx({ date: "2026-09-05", amountCents: 3190, description: "SPOTIFY", cardId: "card-2" }),
			tx({ date: "2026-10-05", amountCents: 3190, description: "SPOTIFY", cardId: "card-2" }),
			...monthly("AMAZON PRIME BR", [1000, 1000, 1000], "2026-08", 12),
		];
		const { recurring } = analyzeHistory(base(txs, { registeredNames: ["Spotify", "Amazon"] }));
		expect(recurring.map((r) => [r.key, r.registered, r.cardId])).toEqual([
			["rec:spotify", true, "card-2"],
			["rec:amazonprime", true, "card-1"],
		]);
	});

	it("dois planos da mesma marca (valores distintos) ganham chaves distintas", () => {
		const txs = [
			...monthly("GOOGLE *Google One", [9690, 9690, 9690], "2026-08", 5),
			...monthly("GOOGLE *Google One", [1990, 1990, 1990], "2026-08", 20),
		];
		expect(analyzeHistory(base(txs)).recurring.map((r) => r.key)).toEqual([
			"rec:googleone:9690",
			"rec:googleone:1990",
		]);
	});
});
