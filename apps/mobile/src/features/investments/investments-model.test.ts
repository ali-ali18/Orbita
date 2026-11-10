import { CLOSE_NOT_READ_REASON, NO_HISTORY_REASON, YIELD_REASONS } from "@orbita/core";
import type {
	InvestmentEvolutionPointDto,
	InvestmentEvolutionResponse,
	InvestmentGroupDto,
	InvestmentMonthlyDto,
	InvestmentMovementDto,
	InvestmentPositionDto,
} from "@orbita/shared";
import { chart } from "@orbita/tokens";
import { describe, expect, it } from "vitest";
import {
	barHeights,
	bpsLabel,
	classRows,
	decimalLabel,
	detailLines,
	emptyYield,
	evolutionChart,
	institutionRows,
	investedCard,
	monthBars,
	monthYieldCard,
	movementRow,
	positionRow,
	positionYield,
	rateText,
	shareLabel,
	shortReason,
	sinceLabel,
	snapshotsChart,
	totalYieldCard,
} from "./investments-model.ts";

describe("texto", () => {
	it("pontos-base viram percentual com uma casa, sem float", () => {
		expect(bpsLabel(83)).toBe("0,8%");
		expect(bpsLabel(370)).toBe("3,7%");
		expect(bpsLabel(-50)).toBe("−0,5%");
		expect(bpsLabel(370, true)).toBe("+3,7%");
		expect(bpsLabel(2)).toBe("0,0%");
	});

	it("participação é inteira", () => {
		expect(shareLabel(5640)).toBe("56%");
		expect(shareLabel(1450)).toBe("15%");
	});

	it("decimal em texto vira pt-BR sem zeros sobrando", () => {
		expect(decimalLabel("102.50")).toBe("102,5");
		expect(decimalLabel("100.00")).toBe("100");
		expect(decimalLabel("1234567.125")).toBe("1.234.567,125");
		expect(decimalLabel("31.4500")).toBe("31,45");
	});
});

describe("mapeamento de motivos", () => {
	it("sem motivo, texto padrão", () => {
		expect(shortReason(null)).toBe("sem como calcular");
		expect(shortReason("  ")).toBe("sem como calcular");
	});

	it("encurta os motivos do engine", () => {
		expect(shortReason("sem histórico ainda")).toBe("sem histórico ainda");
		expect(shortReason("houve resgate parcial; valor aproximado")).toBe("resgate parcial; aproximado");
		expect(shortReason("posição encerrada; ganho realizado estimado pelas movimentações")).toBe(
			"ganho realizado estimado",
		);
		expect(shortReason("posição encerrada: sem as movimentações completas para calcular o ganho")).toBe(
			"sem como calcular",
		);
		expect(shortReason("a posição sumiu da lista do banco: sem saldo atual para calcular")).toBe(
			"sumiu da lista do banco",
		);
	});

	it("motivo desconhecido passa como veio", () => {
		expect(shortReason("fechamento do mês ainda não lido")).toBe("fechamento do mês ainda não lido");
	});
});

describe("cartões de rendimento", () => {
	it("mês sem histórico mostra o motivo no lugar do número, nunca zero", () => {
		const c = monthYieldCard(
			{
				month: "2026-11",
				cents: null,
				partial: false,
				countedPositions: 0,
				missingPositions: 3,
				baselineDay: null,
				reason: "sem histórico ainda",
			},
			false,
		);
		expect(c.value).toBeNull();
		expect(c.caption).toBe("sem histórico ainda");
		expect(c.tone).toBe("secondary");
		expect(c.a11y).toContain("sem valor");
		// Estado vazio desenhado: ícone e UMA expressão curta; nada de prazo que o engine não cumpre.
		expect(c.empty).toEqual({ icon: "relogio", title: "Em alguns dias" });
		expect(c.a11y).toBe("Rendimento no mês: sem valor. Em alguns dias");
	});

	it("cada motivo que o engine realmente devolve sem número tem expressão própria de até 3 palavras", () => {
		// Só motivos alcançáveis: os do engine com `cents: null` (posição, mês e total) e o do gráfico.
		const reasons = [
			NO_HISTORY_REASON,
			CLOSE_NOT_READ_REASON,
			YIELD_REASONS.noBalance,
			YIELD_REASONS.noBasis,
			YIELD_REASONS.redemptionOverInvested,
			YIELD_REASONS.closedUnknown,
			YIELD_REASONS.vanished,
			YIELD_REASONS.connectionRemoved,
			YIELD_REASONS.notSafe,
			"sem valor aplicado nem compras para calcular",
			"sem posições ativas",
			"sem posições",
		];
		for (const r of reasons) {
			const e = emptyYield(r);
			expect(e.title, r).not.toBe("");
			expect(e.title.split(/\s+/).length, r).toBeLessThanOrEqual(3);
			expect(e.title, r).not.toMatch(/[—–-]/);
			expect(["relogio", "grafico"]).toContain(e.icon);
		}
		expect(emptyYield(NO_HISTORY_REASON)).toEqual({ icon: "relogio", title: "Em alguns dias" });
		expect(emptyYield("sem saldo informado").title).toBe("Sem saldo");
		expect(emptyYield("sem valor aplicado nem compras para calcular").title).toBe("Sem valor aplicado");
		expect(emptyYield(YIELD_REASONS.vanished).title).toBe("Sumiu do banco");
		const fallback = emptyYield(null);
		expect(fallback).toEqual({ icon: "grafico", title: "Sem dados do banco" });
		// Texto desconhecido cai no genérico, sem quebrar.
		expect(emptyYield("algo novo do servidor")).toEqual(fallback);
	});

	it("com número não há estado vazio (e valor conhecido nunca vira vazio, nem zero)", () => {
		const c = totalYieldCard(
			{
				cents: 0,
				estimated: false,
				returnBps: 0,
				countedPositions: 1,
				missingPositions: 0,
				reason: null,
			},
			false,
		);
		expect(c.empty).toBeNull();
		expect(c.value).toBe("+R$ 0,00");
	});

	it("aplicado: com valor mostra o valor; sem valor, estado vazio próprio", () => {
		expect(investedCard(1000000, "desde mai/2026", false)).toMatchObject({
			value: "R$ 10.000,00",
			empty: null,
			caption: "desde mai/2026",
		});
		const none = investedCard(null, null, false);
		expect(none.value).toBeNull();
		expect(none.empty).toEqual({ icon: "grafico", title: "Sem valor aplicado" });
	});

	it("mês parcial avisa quantas posições entraram", () => {
		const c = monthYieldCard(
			{
				month: "2026-11",
				cents: 984,
				partial: true,
				countedPositions: 2,
				missingPositions: 1,
				baselineDay: "2026-10-31",
				reason: null,
			},
			false,
		);
		expect(c.value).toBe("+R$ 9,84");
		expect(c.note).toBe("parcial");
		expect(c.caption).toBe("de 2 de 3 posições");
		expect(c.tone).toBe("positive");
	});

	it("total estimado leva o selo e o percentual; perda fica negativa", () => {
		const up = totalYieldCard(
			{
				cents: 4160,
				estimated: true,
				returnBps: 370,
				countedPositions: 3,
				missingPositions: 0,
				reason: null,
			},
			false,
		);
		expect(up).toMatchObject({ value: "+R$ 41,60", note: "estimado", caption: "3,7%", tone: "positive" });
		const down = totalYieldCard(
			{
				cents: -1000,
				estimated: false,
				returnBps: -120,
				countedPositions: 1,
				missingPositions: 1,
				reason: null,
			},
			false,
		);
		expect(down).toMatchObject({ value: "−R$ 10,00", note: null, tone: "danger" });
		expect(down.caption).toBe("−1,2% · em 1 de 2 posições");
	});

	it("total sem número usa o motivo", () => {
		const c = totalYieldCard(
			{
				cents: null,
				estimated: false,
				returnBps: null,
				countedPositions: 0,
				missingPositions: 2,
				reason: "sem valor aplicado nem compras para calcular",
			},
			false,
		);
		expect(c.value).toBeNull();
		expect(c.caption).toBe("sem valor aplicado");
	});

	it("valores escondidos mascaram o dinheiro e mantêm o percentual", () => {
		const c = totalYieldCard(
			{
				cents: 4160,
				estimated: false,
				returnBps: 370,
				countedPositions: 1,
				missingPositions: 0,
				reason: null,
			},
			true,
		);
		expect(c.value).toBe("••••");
		expect(c.caption).toBe("3,7%");
	});

	it("resgate parcial: número com selo e o motivo como legenda quando não há percentual", () => {
		const c = positionYield(
			{
				cents: 500,
				estimated: true,
				basis: "invested",
				returnBps: null,
				reason: "houve resgate parcial; valor aproximado",
			},
			false,
		);
		expect(c.value).toBe("+R$ 5,00");
		expect(c.note).toBe("estimado");
		expect(c.caption).toBe("resgate parcial; aproximado");
	});
});

const group = (key: string, label: string, balanceCents: number, shareBps: number): InvestmentGroupDto => ({
	key,
	label,
	balanceCents,
	shareBps,
	positions: 1,
});

describe("classes e instituições", () => {
	it("cada classe tem a sua cor e o valor/participação vêm formatados", () => {
		const rows = classRows(
			[group("fixed_income", "Renda fixa", 66337, 5640), group("fund", "Fundos", 18036, 1530)],
			false,
		);
		expect(rows[0]).toMatchObject({
			label: "Renda fixa",
			color: chart.blue,
			value: "R$ 663,37",
			share: "56%",
			weight: 66337,
		});
		expect(rows[1]?.color).toBe(chart.aqua);
	});

	it("instituição conhecida usa a cor e o logo da marca; desconhecida usa a paleta", () => {
		const rows = institutionRows(
			[group("a", "Inter", 58250, 5000), group("b", "Banco Qualquer", 11000, 1000)],
			false,
		);
		expect(rows[0]?.badge?.logo).toBe("00416968");
		expect(rows[0]?.color).not.toBe(rows[1]?.color);
		expect(rows[1]?.badge?.logo).toBeNull();
	});

	it("escondido mascara o valor", () => {
		expect(classRows([group("equity", "Ações", 100, 10000)], true)[0]?.value).toBe("••••");
	});
});

const position = (over: Partial<InvestmentPositionDto> = {}): InvestmentPositionDto => ({
	id: "p1",
	name: "CDB Porquinho",
	code: null,
	type: "FIXED_INCOME",
	subtype: "CDB",
	subtypeLabel: "CDB",
	class: "fixed_income",
	classLabel: "Renda fixa",
	status: "ACTIVE",
	active: true,
	currency: "BRL",
	institutionKey: "c1",
	institutionLabel: "Inter",
	balanceCents: 25107,
	grossCents: null,
	investedCents: 24000,
	withdrawableCents: 25107,
	incomeTaxCents: null,
	yield: { cents: 1107, estimated: false, basis: "invested", returnBps: 461, reason: null },
	quantity: null,
	unitValue: null,
	rate: "102",
	rateType: "CDI",
	fixedAnnualRate: null,
	positionDate: null,
	dueDate: "2033-01-14",
	issueDate: null,
	purchaseDate: "2025-03-10",
	issuer: null,
	syncedAt: "2026-11-10T08:00:00.000Z",
	archivedAt: null,
	...over,
});

describe("posições", () => {
	it("ponto de completar só quando o servidor diz que falta algo", () => {
		expect(positionRow(position(), false).needsTerms).toBe(false);
		expect(positionRow(position({ termsApplicable: true, missing: ["rate"] }), false).needsTerms).toBe(true);
		expect(positionRow(position({ termsApplicable: true, missing: [] }), false).needsTerms).toBe(false);
	});

	it("linha da lista: título, tipo e taxa, saldo e rendimento", () => {
		const row = positionRow(position(), false);
		expect(row).toMatchObject({ title: "CDB Porquinho", subtitle: "CDB · 102% do CDI", value: "R$ 251,07" });
		expect(row.yieldCard.value).toBe("+R$ 11,07");
		expect(row.yieldCard.caption).toBe("4,6%");
	});

	it("sem nome usa o código e depois o tipo; sem saldo mostra traço", () => {
		expect(positionRow(position({ name: null, code: "EXEM3" }), false).title).toBe("EXEM3");
		expect(positionRow(position({ name: null, code: null }), false).title).toBe("CDB");
		expect(positionRow(position({ balanceCents: null }), false).value).toBe("sem saldo");
	});

	it("taxa: do índice, prefixada ou nenhuma", () => {
		expect(rateText(position())).toBe("102% do CDI");
		expect(rateText(position({ rate: null, rateType: null, fixedAnnualRate: "11.50" }))).toBe("11,5% a.a.");
		expect(rateText(position({ rate: null, rateType: null }))).toBeNull();
	});

	it("detalhe só traz o que o banco informou", () => {
		const lines = detailLines(position(), false);
		expect(lines).toEqual([
			{ label: "Taxa", value: "102% do CDI" },
			{ label: "Vence em", value: "14/01/2033" },
			{ label: "Disponível para resgate", value: "R$ 251,07" },
		]);
		expect(
			detailLines(position({ rate: null, rateType: null, dueDate: null, withdrawableCents: null }), false),
		).toEqual([]);
	});

	it("com o olho fechado, quantidade e valor da cota somem (dariam o saldo)", () => {
		const p = position({ quantity: "100", unitValue: "31.45" });
		const shown = detailLines(p, false).map((l) => l.label);
		expect(shown).toContain("Quantidade");
		expect(shown).toContain("Valor da cota");
		const hiddenLabels = detailLines(p, true).map((l) => l.label);
		expect(hiddenLabels).not.toContain("Quantidade");
		expect(hiddenLabels).not.toContain("Valor da cota");
	});

	it("desde mês/ano pela compra ou emissão", () => {
		expect(sinceLabel(position())).toBe("desde mar/2025");
		expect(sinceLabel(position({ purchaseDate: null, issueDate: "2024-12-01" }))).toBe("desde dez/2024");
		expect(sinceLabel(position({ purchaseDate: null }))).toBeNull();
	});
});

const movement = (over: Partial<InvestmentMovementDto>): InvestmentMovementDto => ({
	id: "m",
	type: null,
	movementType: null,
	kind: "other",
	date: "2026-11-03",
	tradeDate: null,
	amountCents: 10000,
	netAmountCents: null,
	quantity: null,
	unitValue: null,
	description: null,
	...over,
});

describe("movimentações", () => {
	it("aplicação positiva, resgate e imposto com sinal negativo", () => {
		expect(movementRow(movement({ kind: "contribution" }), false)).toMatchObject({
			title: "Aplicação",
			value: "R$ 100,00",
			date: "3 de nov",
		});
		expect(movementRow(movement({ kind: "withdrawal", amountCents: 3000 }), false).value).toBe("−R$ 30,00");
		const tax = movementRow(movement({ movementType: "TAX", amountCents: 42 }), false);
		expect(tax.title).toBe("Imposto");
		expect(tax.value).toBe("−R$ 0,42");
	});

	it("outro tipo sem nome conhecido usa o texto do banco como dado", () => {
		expect(movementRow(movement({ description: "Crédito de juros" }), false).title).toBe("Crédito de juros");
		expect(movementRow(movement({}), false).title).toBe("Movimentação");
		expect(movementRow(movement({ amountCents: null, kind: "contribution" }), false).value).toBe("sem valor");
	});
});

const point = (
	day: string,
	balance: number,
	over: Partial<InvestmentEvolutionPointDto> = {},
): InvestmentEvolutionPointDto => ({
	day,
	balanceCents: balance,
	investedCents: balance - 100,
	investedEstimated: false,
	investedComplete: true,
	positions: 1,
	carriedPositions: 0,
	missingPositions: 0,
	...over,
});

const evolution = (points: InvestmentEvolutionPointDto[]): InvestmentEvolutionResponse => ({
	range: "6m",
	from: "2026-06-01",
	to: "2026-11-10",
	coveredFrom: points[0]?.day ?? null,
	points,
	reason: points.length === 0 ? "sem histórico ainda" : null,
});

describe("evolução", () => {
	it("sem pontos não desenha nada", () => {
		const c = evolutionChart(evolution([]));
		expect(c.balanceRuns).toEqual([]);
		expect(c.onlyIncomplete).toBe(false);
		expect(c.lastBalanceCents).toBeNull();
		expect(c.span).toBeNull();
	});

	it("posiciona os dias pela data e rotula um por mês", () => {
		const c = evolutionChart(
			evolution([point("2026-10-01", 1000), point("2026-10-11", 1100), point("2026-11-10", 1300)]),
		);
		expect(c.balanceRuns).toHaveLength(1);
		expect(c.balanceRuns[0]?.map((p) => p.x)).toEqual([0, 10, 40]);
		expect(c.xMax).toBe(40);
		// Chão abaixo do menor valor (900 aplicado, menos 25% da amplitude): a linha não parte do zero.
		expect(c.yMax).toBe(1300 - 800);
		expect(c.balanceRuns[0]?.map((p) => p.y)).toEqual([200, 300, 500]);
		expect(c.ticks.map((t) => t.label)).toEqual(["out", "nov"]);
		expect(c.lastBalanceCents).toBe(1300);
		expect(c.span).toBe("de 1 de out a 10 de nov");
	});

	it("dia incompleto não liga a linha e é contado", () => {
		const c = evolutionChart(
			evolution([
				point("2026-11-01", 1000),
				point("2026-11-02", 400, { missingPositions: 1 }),
				point("2026-11-03", 1050),
			]),
		);
		expect(c.balanceRuns).toHaveLength(2);
		expect(c.hiddenDays).toBe(1);
		// O dia incompleto (400) não puxa o chão para baixo.
		expect(c.balanceRuns[0]?.[0]?.y).toBe(c.yMax - 50);
	});

	it("aplicado incompleto não entra na linha tracejada", () => {
		const c = evolutionChart(
			evolution([point("2026-11-01", 1000, { investedComplete: false }), point("2026-11-02", 1010)]),
		);
		expect(c.balanceRuns[0]).toHaveLength(2);
		expect(c.investedRuns).toHaveLength(1);
		expect(c.investedRuns[0]).toHaveLength(1);
	});

	it("buraco no aplicado quebra a linha tracejada em vez de ligar por cima", () => {
		const c = evolutionChart(
			evolution([
				point("2026-11-01", 1000),
				point("2026-11-02", 1010, { investedComplete: false }),
				point("2026-11-03", 1020),
			]),
		);
		expect(c.balanceRuns).toHaveLength(1);
		expect(c.investedRuns).toHaveLength(2);
	});

	it("aplicado estimado é sinalizado para a legenda", () => {
		expect(evolutionChart(evolution([point("2026-11-01", 1000)])).investedEstimated).toBe(false);
		expect(
			evolutionChart(evolution([point("2026-11-01", 1000, { investedEstimated: true })])).investedEstimated,
		).toBe(true);
	});

	it("todos os dias incompletos: há pontos mas nenhum trecho, e não é 'sem histórico'", () => {
		const c = evolutionChart(
			evolution([
				point("2026-11-01", 400, { missingPositions: 1 }),
				point("2026-11-02", 410, { missingPositions: 2 }),
			]),
		);
		expect(c.balanceRuns).toEqual([]);
		expect(c.onlyIncomplete).toBe(true);
		expect(c.hiddenDays).toBe(2);
		expect(c.lastBalanceCents).toBeNull();
		expect(c.lastBalanceLabel).toBeNull();
	});

	it("o número grande leva a data do último dia completo, não a do último ponto", () => {
		const c = evolutionChart(
			evolution([
				point("2026-11-07", 1000),
				point("2026-11-08", 1100),
				point("2026-11-10", 300, { missingPositions: 1 }),
			]),
		);
		expect(c.lastBalanceCents).toBe(1100);
		expect(c.lastBalanceLabel).toBe("em 8 de nov");
		expect(c.span).toBe("de 7 de nov a 10 de nov");
	});
});

const month = (
	m: string,
	c: number,
	y: number | null,
	over: Partial<InvestmentMonthlyDto> = {},
): InvestmentMonthlyDto => ({
	month: m,
	contributionsCents: c,
	withdrawalsCents: 0,
	netContributionsCents: c,
	yieldCents: y,
	yieldPartial: false,
	yieldReason: y === null ? "sem histórico ainda" : null,
	...over,
});

describe("aportes e rendimento por mês", () => {
	it("cabeçalho do mês traz os dois valores", () => {
		const [bar] = monthBars([month("2026-11", 4416, 984)], false);
		expect(bar).toMatchObject({
			label: "nov",
			contribution: "R$ 44,16",
			yieldText: "+R$ 9,84 de rendimento",
			yieldTone: "positive",
			withdrawal: null,
		});
	});

	it("mês sem rendimento mostra o motivo; parcial e resgate aparecem", () => {
		const bars = monthBars(
			[
				month("2026-07", 100, null),
				month("2026-08", 100, 50, { yieldPartial: true, withdrawalsCents: 2500 }),
			],
			false,
		);
		expect(bars[0]?.yieldText).toBe("sem histórico ainda");
		expect(bars[1]?.yieldText).toBe("+R$ 0,50 de rendimento (parcial)");
		expect(bars[1]?.withdrawal).toBe("R$ 25,00");
	});

	it("alturas na mesma escala: maior ocupa o máximo, positivo nunca some, null e zero não desenham", () => {
		expect(barHeights([5000, 500, 0, null, 1], 100, 8)).toEqual([100, 10, 0, 0, 8]);
		expect(barHeights([null, 0], 100, 8)).toEqual([0, 0]);
		expect(barHeights([-200, 100], 100, 8)).toEqual([100, 50]);
	});
});

describe("retratos de uma posição", () => {
	it("viram a mesma linha da evolução; aplicado ausente não entra", () => {
		const c = snapshotsChart([
			{ day: "2026-11-01", balanceCents: 1000, investedCents: 900 },
			{ day: "2026-11-03", balanceCents: 1020, investedCents: null },
		]);
		expect(c.balanceRuns[0]?.map((p) => p.x)).toEqual([0, 2]);
		expect(c.investedRuns).toHaveLength(1);
		expect(snapshotsChart([]).balanceRuns).toEqual([]);
	});

	it("retrato sem aplicado no meio quebra o tracejado", () => {
		const c = snapshotsChart([
			{ day: "2026-11-01", balanceCents: 1000, investedCents: 900 },
			{ day: "2026-11-02", balanceCents: 1010, investedCents: null },
			{ day: "2026-11-03", balanceCents: 1020, investedCents: 900 },
		]);
		expect(c.investedRuns).toHaveLength(2);
	});
});
