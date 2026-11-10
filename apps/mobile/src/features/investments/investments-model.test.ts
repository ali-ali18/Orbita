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
	evolutionChart,
	institutionRows,
	monthBars,
	monthYieldCard,
	movementRow,
	positionRow,
	positionYield,
	rateText,
	shareLabel,
	shortReason,
	sinceLabel,
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
	it("linha da lista: título, tipo e taxa, saldo e rendimento", () => {
		const row = positionRow(position(), false);
		expect(row).toMatchObject({ title: "CDB Porquinho", subtitle: "CDB · 102% do CDI", value: "R$ 251,07" });
		expect(row.yieldCard.value).toBe("+R$ 11,07");
		expect(row.yieldCard.caption).toBe("4,6%");
	});

	it("sem nome usa o código e depois o tipo; sem saldo mostra traço", () => {
		expect(positionRow(position({ name: null, code: "EXEM3" }), false).title).toBe("EXEM3");
		expect(positionRow(position({ name: null, code: null }), false).title).toBe("CDB");
		expect(positionRow(position({ balanceCents: null }), false).value).toBe("—");
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
		expect(movementRow(movement({ amountCents: null, kind: "contribution" }), false).value).toBe("—");
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
		expect(c.segments).toEqual([]);
		expect(c.lastBalanceCents).toBeNull();
		expect(c.span).toBeNull();
	});

	it("posiciona os dias pela data e rotula um por mês", () => {
		const c = evolutionChart(
			evolution([point("2026-10-01", 1000), point("2026-10-11", 1100), point("2026-11-10", 1300)]),
		);
		expect(c.segments).toHaveLength(1);
		expect(c.segments[0]?.balance.map((p) => p.x)).toEqual([0, 10, 40]);
		expect(c.xMax).toBe(40);
		expect(c.yMax).toBe(1300);
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
		expect(c.segments).toHaveLength(2);
		expect(c.hiddenDays).toBe(1);
		expect(c.yMax).toBe(1050);
	});

	it("aplicado incompleto não entra na linha tracejada", () => {
		const c = evolutionChart(
			evolution([point("2026-11-01", 1000, { investedComplete: false }), point("2026-11-02", 1010)]),
		);
		expect(c.segments[0]?.balance).toHaveLength(2);
		expect(c.segments[0]?.invested).toHaveLength(1);
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
