import { MAX_CENTS } from "@orbita/shared";
import { chart, chartSeries } from "@orbita/tokens";
import { describe, expect, it } from "vitest";
import {
	amountToDigits,
	applyAmountText,
	buildRequest,
	canInstall,
	categoryDot,
	effectiveSource,
	formatAmount,
	formatEntryDate,
	initialForm,
	installmentLabel,
	installmentPreview,
	isAffectedByNewTransaction,
	maskBrDate,
	type NewTransactionForm,
	parseBrDate,
	quickDates,
	sourceOptions,
	withKind,
	withSource,
} from "./new-transaction-model.ts";

const accounts = [
	{ id: "a1", name: "Nubank", bankCode: "18236120", archivedAt: null },
	{ id: "a2", name: "Antiga", bankCode: null, archivedAt: "2026-01-01T00:00:00Z" },
];
const cards = [
	{ id: "c1", name: "Nubank", bankCode: "18236120", last4: "0695", archivedAt: null },
	{ id: "c2", name: "Velho", bankCode: null, last4: null, archivedAt: "2026-01-01T00:00:00Z" },
];
const expenseOptions = sourceOptions("expense", accounts, cards);
const [account, card] = expenseOptions;
if (!account || !card) throw new Error("fixture");

const base = (over: Partial<NewTransactionForm> = {}): NewTransactionForm => ({
	...initialForm("2026-11-06"),
	amountCents: 4690,
	description: "  iFood ",
	...over,
});

describe("teclado de centavos", () => {
	it("cada dígito entra à direita: 4690 vale R$ 46,90", () => {
		expect(applyAmountText(0, "4")).toBe(4);
		expect(applyAmountText(4, "46")).toBe(46);
		expect(applyAmountText(46, "4690")).toBe(4690);
		expect(formatAmount(4690)).toBe("R$ 46,90");
		expect(formatAmount(0)).toBe("R$ 0,00");
	});

	it("apagar tira o último dígito e zero esvazia o campo", () => {
		expect(applyAmountText(4690, "469")).toBe(469);
		expect(applyAmountText(4, "")).toBe(0);
		expect(amountToDigits(0)).toBe("");
		expect(amountToDigits(4690)).toBe("4690");
	});

	it("ignora o que não é dígito e zeros à esquerda", () => {
		expect(applyAmountText(0, "R$ 0,05")).toBe(5);
		expect(applyAmountText(0, "000")).toBe(0);
	});

	it("não passa do teto da API: mantém o valor anterior", () => {
		expect(applyAmountText(0, String(MAX_CENTS))).toBe(MAX_CENTS);
		expect(applyAmountText(MAX_CENTS, `${MAX_CENTS}0`)).toBe(MAX_CENTS);
		expect(applyAmountText(214748364, "2147483648")).toBe(214748364);
		expect(Number.isInteger(applyAmountText(0, "99999999999999999999"))).toBe(true);
	});
});

describe("conta ou cartão", () => {
	it("saída lista contas e cartões ativos; arquivados somem", () => {
		expect(expenseOptions.map((o) => o.key)).toEqual(["account:a1", "card:c1"]);
		expect(card.label).toBe("Nubank · crédito");
		expect(card.detail).toBe("••••0695");
		expect(account.label).toBe("Nubank");
	});

	it("entrada só lista contas (receita não entra em cartão)", () => {
		expect(sourceOptions("income", accounts, cards).map((o) => o.type)).toEqual(["account"]);
	});

	it("sem escolha vale a primeira; escolha que saiu da lista também cai na primeira", () => {
		expect(effectiveSource(null, expenseOptions)?.key).toBe("account:a1");
		expect(effectiveSource("card:c1", expenseOptions)?.key).toBe("card:c1");
		expect(effectiveSource("card:c1", sourceOptions("income", accounts, cards))?.key).toBe("account:a1");
		expect(effectiveSource(null, [])).toBeNull();
	});

	it("a conta padrão vale quando nada foi escolhido, mas a escolha do dono vence e conta que saiu da lista é ignorada", () => {
		expect(effectiveSource(null, expenseOptions, "card:c1")?.key).toBe("card:c1");
		expect(effectiveSource("account:a1", expenseOptions, "card:c1")?.key).toBe("account:a1");
		expect(effectiveSource(null, expenseOptions, "account:arquivada")?.key).toBe("account:a1");
		expect(effectiveSource(null, expenseOptions, null)?.key).toBe("account:a1");
	});

	it("só despesa no cartão parcela", () => {
		expect(canInstall("expense", card)).toBe(true);
		expect(canInstall("expense", account)).toBe(false);
		expect(canInstall("income", account)).toBe(false);
		expect(canInstall("expense", null)).toBe(false);
	});

	it("virar Entrada solta o cartão e as parcelas; trocar para conta zera as parcelas", () => {
		const parcelado = base({ sourceKey: "card:c1", installments: 6 });
		const entrada = withKind(parcelado, "income");
		expect(entrada).toMatchObject({ kind: "income", sourceKey: null, installments: 1 });
		expect(withKind(base({ sourceKey: "account:a1" }), "income").sourceKey).toBe("account:a1");
		expect(withSource(parcelado, "account:a1").installments).toBe(1);
		expect(withSource(parcelado, "card:c1").installments).toBe(6);
	});
});

describe("parcelas", () => {
	it("prévia é só estimativa em inteiros, ao centavo mais próximo", () => {
		expect(installmentPreview(10000, 3)).toBe(3333);
		expect(installmentPreview(10001, 2)).toBe(5001);
		expect(installmentPreview(4690, 1)).toBeNull();
		expect(installmentPreview(0, 6)).toBeNull();
		expect(Number.isInteger(installmentPreview(MAX_CENTS, 72))).toBe(true);
	});

	it("rótulos: à vista, só a contagem, ou contagem com valor aproximado", () => {
		expect(installmentLabel(1, 4690)).toBe("À vista");
		expect(installmentLabel(6, 4690)).toBe("6× de ~R$ 7,82");
		expect(installmentLabel(6, 0)).toBe("6×");
	});
});

describe("data", () => {
	it("formata Hoje, Ontem e outros dias, com ano só se for outro ano", () => {
		expect(formatEntryDate("2026-11-06", "2026-11-06")).toBe("Hoje, 6 de novembro");
		expect(formatEntryDate("2026-11-05", "2026-11-06")).toBe("Ontem, 5 de novembro");
		expect(formatEntryDate("2026-10-31", "2026-11-06")).toBe("31 de outubro");
		expect(formatEntryDate("2025-12-25", "2026-11-06")).toBe("25 de dezembro de 2025");
		expect(quickDates("2026-03-01")).toEqual(["2026-03-01", "2026-02-28", "2026-02-27"]);
	});

	it("lê DD/MM/AAAA e recusa data que não existe", () => {
		expect(parseBrDate("05/11/2026")).toBe("2026-11-05");
		expect(parseBrDate("05112026")).toBe("2026-11-05");
		expect(parseBrDate("30/02/2026")).toBeNull();
		expect(parseBrDate("05/11/26")).toBeNull();
		expect(parseBrDate("05/11/1800")).toBeNull();
		expect(maskBrDate("05112026")).toBe("05/11/2026");
		expect(maskBrDate("0511")).toBe("05/11");
	});
});

describe("categoria", () => {
	it("a bolinha segue o espaço do gráfico; sem espaço vira cinza", () => {
		expect(categoryDot(0)).toBe(chartSeries[0]);
		expect(categoryDot(4)).toBe(chartSeries[4]);
		expect(categoryDot(null)).toBe(chart.other);
		expect(categoryDot(null, "moradia")).toBe(chart.violet);
	});
});

describe("buildRequest", () => {
	it("despesa à vista na conta: corpo de POST /v1/transactions, descrição aparada", () => {
		const r = buildRequest(base({ categoryId: "cat1" }), account);
		expect(r).toEqual({
			ok: true,
			request: {
				type: "single",
				body: {
					kind: "expense",
					amountCents: 4690,
					date: "2026-11-06",
					description: "iFood",
					accountId: "a1",
					categoryId: "cat1",
				},
			},
		});
	});

	it("despesa à vista no cartão manda cardId e nada de accountId; sem categoria não manda categoryId", () => {
		const r = buildRequest(base(), card);
		expect(r).toMatchObject({ ok: true, request: { type: "single", body: { cardId: "c1" } } });
		if (r.ok) {
			expect(r.request.body).not.toHaveProperty("accountId");
			expect(r.request.body).not.toHaveProperty("categoryId");
		}
	});

	it("receita em conta", () => {
		const r = buildRequest(base({ kind: "income" }), account);
		expect(r).toMatchObject({ ok: true, request: { body: { kind: "income", accountId: "a1" } } });
	});

	it("receita em cartão é recusada com a mensagem da regra", () => {
		const r = buildRequest(base({ kind: "income" }), card);
		expect(r).toEqual({
			ok: false,
			message: "Receita entra em uma conta, não no cartão. Para cashback ou devolução, lance um estorno.",
		});
	});

	it("parcelado no cartão vai para /installments, em centavos inteiros", () => {
		const r = buildRequest(base({ amountCents: 120000, installments: 12, categoryId: "cat1" }), card);
		expect(r).toEqual({
			ok: true,
			request: {
				type: "installments",
				body: {
					cardId: "c1",
					totalCents: 120000,
					count: 12,
					date: "2026-11-06",
					description: "iFood",
					categoryId: "cat1",
				},
			},
		});
	});

	it("parcelar fora do cartão ou fora de 2..72 é recusado em pt-BR", () => {
		expect(buildRequest(base({ installments: 3 }), account)).toEqual({
			ok: false,
			message: "Só compra no cartão pode ser parcelada.",
		});
		expect(buildRequest(base({ installments: 73 }), card)).toEqual({
			ok: false,
			message: "O parcelamento vai de 2 a 72 parcelas.",
		});
		expect(buildRequest(base({ amountCents: 2, installments: 3 }), card)).toEqual({
			ok: false,
			message: "O total é menor que o número de parcelas.",
		});
	});

	it("valida valor, descrição e conta antes de enviar", () => {
		expect(buildRequest(base({ amountCents: 0 }), account)).toEqual({
			ok: false,
			message: "O valor deve ser maior que zero.",
		});
		expect(buildRequest(base({ description: "   " }), account)).toEqual({
			ok: false,
			message: "Informe a descrição do lançamento.",
		});
		expect(buildRequest(base(), null)).toEqual({ ok: false, message: "Escolha a conta ou o cartão." });
		expect(buildRequest(base({ date: "2026-02-30" }), account)).toMatchObject({ ok: false });
	});
});

describe("invalidação depois de salvar", () => {
	it("atualiza resumo, últimos lançamentos, fatura e parcelas do servidor atual; cadastros ficam", () => {
		const url = "https://x.dev";
		for (const k of ["summary", "transactions", "invoice", "installments"]) {
			expect(isAffectedByNewTransaction([url, k, "2026-11"], url)).toBe(true);
		}
		expect(isAffectedByNewTransaction([url, "cards"], url)).toBe(false);
		expect(isAffectedByNewTransaction(["https://outro.dev", "summary", "2026-11"], url)).toBe(false);
	});
});
