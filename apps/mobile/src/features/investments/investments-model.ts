import type {
	InvestmentClassValue,
	InvestmentEvolutionPointDto,
	InvestmentEvolutionResponse,
	InvestmentGroupDto,
	InvestmentMonthlyDto,
	InvestmentMonthYieldDto,
	InvestmentMovementDto,
	InvestmentPositionDto,
	InvestmentSnapshotDto,
	InvestmentTotalYieldDto,
	InvestmentYieldDto,
} from "@orbita/shared";
import { chart, chartSeries } from "@orbita/tokens";
import { dayMonth, money, monthShort } from "../../lib/format.ts";
import type { BankBadge, IconName } from "../../ui/index.ts";
import { bankBadge, bankColor } from "../summary/summary-model.ts";

/*
 * Do DTO de Investimentos para o que a tela mostra. A API devolve os números prontos; aqui só se FORMATA (texto, cor,
 * rótulo) e nada se calcula. `null` é "não sei", nunca zero: vira o motivo curto no lugar do número.
 */

// ---------------------------------------------------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------------------------------------------------

/** Motivos do servidor em versão curta para o cartão pequeno. Texto desconhecido passa como veio (já é pt-BR). */
const SHORT_REASONS: ReadonlyArray<readonly [string, string]> = [
	["sem histórico ainda", "sem histórico ainda"],
	["sem saldo informado", "sem saldo informado"],
	["sem valor aplicado", "sem valor aplicado"],
	["houve resgate parcial", "resgate parcial; aproximado"],
	["resgates maiores", "sem como estimar"],
	["o banco já reduziu", "aproximado"],
	["posição encerrada: sem as movimentações", "sem como calcular"],
	["posição encerrada", "ganho realizado estimado"],
	["a posição sumiu", "sumiu da lista do banco"],
	["conexão removida", "conexão removida"],
	["não deu para calcular", "sem como calcular"],
	["sem posições", "sem posições"],
];

export const NO_YIELD_FALLBACK = "sem como calcular";

/** O motivo curto para mostrar no lugar de um número que faltou. */
export function shortReason(reason: string | null | undefined): string {
	const text = reason?.trim();
	if (!text) return NO_YIELD_FALLBACK;
	const lower = text.toLowerCase();
	for (const [prefix, short] of SHORT_REASONS) if (lower.startsWith(prefix)) return short;
	return text;
}

/** Estado vazio de um número que não existe: ícone do app e UMA expressão curta (nunca traço, nunca zero). */
export interface YieldEmpty {
	icon: Extract<IconName, "relogio" | "grafico">;
	title: string;
}

const NO_NUMBER = (title: string): YieldEmpty => ({ icon: "grafico", title });

/**
 * Motivo do servidor (prefixo) → estado vazio. Só os motivos que o engine devolve de fato sem número (posição, mês,
 * total e gráfico); os de resgate parcial e "posição encerrada; ganho estimado" vêm COM número e nunca chegam aqui.
 */
const EMPTY_BY_REASON: ReadonlyArray<readonly [string, YieldEmpty]> = [
	["sem histórico ainda", { icon: "relogio", title: "Em alguns dias" }],
	["sem saldo informado", NO_NUMBER("Sem saldo")],
	["sem valor aplicado", NO_NUMBER("Sem valor aplicado")],
	["resgates maiores", NO_NUMBER("Sem como estimar")],
	["posição encerrada: sem as movimentações", NO_NUMBER("Sem como calcular")],
	["resgate ainda não lido", NO_NUMBER("Falta o resgate")],
	["a posição sumiu", NO_NUMBER("Sumiu do banco")],
	["conexão removida", NO_NUMBER("Conexão removida")],
	["sem posições", NO_NUMBER("Sem posições")],
	["não deu para calcular", NO_NUMBER("Sem como calcular")],
];

/** O estado vazio para o motivo; motivo desconhecido ou ausente cai em "Sem dados do banco". */
export function emptyYield(reason: string | null | undefined): YieldEmpty {
	const lower = reason?.trim().toLowerCase() ?? "";
	for (const [prefix, empty] of EMPTY_BY_REASON) if (lower.startsWith(prefix)) return empty;
	return NO_NUMBER("Sem dados do banco");
}

/** Pontos-base em percentual com uma casa: 370 → "3,7%", −50 → "−0,5%". Só texto, sem float. */
export function bpsLabel(bps: number, sign = false): string {
	const tenths = Math.round(Math.abs(bps) / 10);
	const body = `${Math.trunc(tenths / 10)},${tenths % 10}%`;
	if (bps < 0 && tenths > 0) return `−${body}`;
	return sign && tenths > 0 ? `+${body}` : body;
}

/** Participação inteira: 5600 → "56%". */
export function shareLabel(bps: number): string {
	return `${Math.round(bps / 100)}%`;
}

/** Decimal em texto ("102.50", "31.4500") → "102,5". Sem passar por número. */
export function decimalLabel(value: string): string {
	const [whole = "0", frac = ""] = value.trim().split(".");
	const trimmed = frac.replace(/0+$/, "");
	const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
	return trimmed ? `${grouped},${trimmed}` : grouped;
}

// ---------------------------------------------------------------------------------------------------------------------
// Rendimento (cartões do topo)
// ---------------------------------------------------------------------------------------------------------------------

export interface YieldCard {
	/** "+R$ 9,84"; `null` = sem número (a legenda traz o motivo). */
	value: string | null;
	tone: "positive" | "danger" | "secondary";
	/** Legenda de baixo: percentual ou motivo. */
	caption: string;
	/** Selo "estimado" ou "parcial" ao lado do rótulo, quando vale. */
	note: string | null;
	/** Sem número: o estado vazio desenhado no lugar do valor (e da legenda). `null` quando há valor. */
	empty: YieldEmpty | null;
	/** Frase inteira para leitor de tela. */
	a11y: string;
}

function yieldTone(cents: number): YieldCard["tone"] {
	return cents > 0 ? "positive" : cents < 0 ? "danger" : "secondary";
}

function card(
	label: string,
	cents: number | null,
	caption: string,
	note: string | null,
	hidden: boolean,
	reason?: string | null,
): YieldCard {
	const value = cents === null ? null : money(cents, hidden, { sign: "always" });
	const empty = cents === null ? emptyYield(reason) : null;
	return {
		value,
		tone: cents === null ? "secondary" : yieldTone(cents),
		caption,
		note,
		empty,
		a11y: empty
			? `${label}: sem valor. ${empty.title}`
			: `${label}: ${value}, ${caption}${note ? `, ${note}` : ""}`,
	};
}

/** Cartão "Aplicado" do detalhe: o valor, ou o estado vazio se o banco não mandou. */
export function investedCard(cents: number | null, since: string | null, hidden: boolean): YieldCard {
	const value = cents === null ? null : money(cents, hidden, { sign: "never" });
	const empty = cents === null ? emptyYield("sem valor aplicado") : null;
	const caption = since ?? "valor aplicado";
	return {
		value,
		tone: "secondary",
		caption,
		note: null,
		empty,
		a11y: empty ? `Aplicado: sem valor. ${empty.title}` : `Aplicado: ${value}, ${caption}`,
	};
}

/** Rendimento do mês: "partial" quando cobre só parte das posições; sem número, o motivo ("sem histórico ainda"). */
export function monthYieldCard(y: InvestmentMonthYieldDto, hidden: boolean): YieldCard {
	if (y.cents === null) return card("Rendimento no mês", null, shortReason(y.reason), null, hidden, y.reason);
	return card(
		"Rendimento no mês",
		y.cents,
		y.partial
			? `de ${y.countedPositions} de ${y.countedPositions + y.missingPositions} posições`
			: y.baselineDay
				? `desde ${dayMonth(y.baselineDay)}`
				: "no mês",
		y.partial ? "parcial" : null,
		hidden,
	);
}

/** Rendimento total: "estimado" quando o DTO diz; "em N de M posições" quando não cobre todas. */
export function totalYieldCard(y: InvestmentTotalYieldDto, hidden: boolean): YieldCard {
	if (y.cents === null) return card("Rendimento total", null, shortReason(y.reason), null, hidden, y.reason);
	const covers =
		y.missingPositions > 0
			? `em ${y.countedPositions} de ${y.countedPositions + y.missingPositions} posições`
			: null;
	const pct = y.returnBps === null ? null : bpsLabel(y.returnBps);
	return card(
		"Rendimento total",
		y.cents,
		[pct, covers].filter(Boolean).join(" · ") || "desde o início",
		y.estimated ? "estimado" : null,
		hidden,
	);
}

/** Rendimento de uma posição (lista e detalhe). */
export function positionYield(y: InvestmentYieldDto, hidden: boolean): YieldCard {
	if (y.cents === null) return card("Rendimento", null, shortReason(y.reason), null, hidden, y.reason);
	const pct = y.returnBps === null ? null : bpsLabel(y.returnBps);
	// Resgate parcial vem com número E motivo: o motivo é nota.
	const caption = pct ?? (y.reason ? shortReason(y.reason) : "");
	return card("Rendimento", y.cents, caption, y.estimated ? "estimado" : null, hidden);
}

// ---------------------------------------------------------------------------------------------------------------------
// Classes e instituições
// ---------------------------------------------------------------------------------------------------------------------

export const CLASS_COLORS: Record<InvestmentClassValue, string> = {
	fixed_income: chart.blue,
	equity: chart.violet,
	fund: chart.aqua,
	other: chart.yellow,
};

export interface GroupRow {
	key: string;
	label: string;
	color: string;
	/** Peso do gráfico (centavos); a rosca e as barras escalam por ele. */
	weight: number;
	value: string;
	share: string;
	badge: BankBadge | null;
}

export function classRows(groups: readonly InvestmentGroupDto[], hidden: boolean): GroupRow[] {
	return groups.map((g) => ({
		key: g.key,
		label: g.label,
		color: CLASS_COLORS[g.key as InvestmentClassValue] ?? chart.other,
		weight: g.balanceCents,
		value: money(g.balanceCents, hidden, { sign: "never" }),
		share: shareLabel(g.shareBps),
		badge: null,
	}));
}

/** Cor da marca do banco; banco sem marca conhecida usa a paleta de gráficos, uma cor por posição. */
export function institutionRows(groups: readonly InvestmentGroupDto[], hidden: boolean): GroupRow[] {
	return groups.map((g, i) => {
		const brand = bankColor(null, g.label);
		const badge = bankBadge({ name: g.label });
		return {
			key: g.key,
			label: g.label,
			color: badge.logo ? brand : (chartSeries[i % chartSeries.length] ?? chart.other),
			weight: g.balanceCents,
			value: money(g.balanceCents, hidden, { sign: "never" }),
			share: shareLabel(g.shareBps),
			badge,
		};
	});
}

/** Frase do gráfico para leitor de tela: "Patrimônio por classe: Renda fixa R$ 663,37, 56%; …". */
export function groupsA11y(title: string, rows: readonly GroupRow[]): string {
	return `${title}: ${rows.map((r) => `${r.label} ${r.value}, ${r.share}`).join("; ")}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Posições
// ---------------------------------------------------------------------------------------------------------------------

export interface PositionRow {
	id: string;
	title: string;
	subtitle: string;
	value: string;
	yieldCard: YieldCard;
	badge: BankBadge;
}

/** "100% do CDI", "9,5% a.a."; `null` sem taxa contratada. Rentabilidade contratada, não medida. */
export function rateText(
	p: Pick<InvestmentPositionDto, "rate" | "rateType" | "fixedAnnualRate">,
): string | null {
	if (p.rate && p.rateType) {
		const type = p.rateType.toUpperCase();
		if (type === "CDI" || type === "SELIC" || type === "IPCA") return `${decimalLabel(p.rate)}% do ${type}`;
		return `${decimalLabel(p.rate)}% ${p.rateType}`;
	}
	if (p.fixedAnnualRate) return `${decimalLabel(p.fixedAnnualRate)}% a.a.`;
	return null;
}

export function positionTitle(
	p: Pick<InvestmentPositionDto, "name" | "code" | "subtypeLabel" | "classLabel">,
): string {
	return p.name?.trim() || p.code?.trim() || p.subtypeLabel || p.classLabel;
}

/** No lugar do saldo que o banco não mandou (nunca zero, nunca traço). */
export const NO_BALANCE = "sem saldo";

export function positionRow(p: InvestmentPositionDto, hidden: boolean): PositionRow {
	const subtitle = [p.subtypeLabel ?? p.classLabel, rateText(p)].filter(Boolean).join(" · ");
	return {
		id: p.id,
		title: positionTitle(p),
		subtitle,
		value: p.balanceCents === null ? NO_BALANCE : money(p.balanceCents, hidden, { sign: "never" }),
		yieldCard: positionYield(p.yield, hidden),
		badge: bankBadge({ name: p.institutionLabel }),
	};
}

export interface DetailLine {
	label: string;
	value: string;
}

/** "mar/2025" para "2025-03-10". */
export function monthYearShort(date: string): string {
	return `${monthShort(date)}/${date.slice(0, 4)}`;
}

/** "14/01/2033". */
export function fullDate(date: string): string {
	return `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
}

/** Linhas de dados do detalhe; só as que o banco informou. */
export function detailLines(p: InvestmentPositionDto, hidden: boolean): DetailLine[] {
	const lines: DetailLine[] = [];
	const rate = rateText(p);
	if (rate) lines.push({ label: "Taxa", value: rate });
	// Quantidade e valor da cota dão o saldo: com o olho fechado não aparecem.
	if (p.quantity && !hidden) lines.push({ label: "Quantidade", value: decimalLabel(p.quantity) });
	if (p.unitValue && !hidden)
		lines.push({ label: "Valor da cota", value: `R$ ${decimalLabel(p.unitValue)}` });
	if (p.dueDate) lines.push({ label: "Vence em", value: fullDate(p.dueDate) });
	if (p.withdrawableCents !== null)
		lines.push({
			label: "Disponível para resgate",
			value: money(p.withdrawableCents, hidden, { sign: "never" }),
		});
	if (p.incomeTaxCents !== null)
		lines.push({ label: "Imposto estimado", value: money(p.incomeTaxCents, hidden, { sign: "never" }) });
	if (p.issuer) lines.push({ label: "Emissor", value: p.issuer });
	return lines;
}

/** "desde mar/2025" quando se sabe a data da compra ou da emissão. */
export function sinceLabel(p: Pick<InvestmentPositionDto, "purchaseDate" | "issueDate">): string | null {
	const date = p.purchaseDate ?? p.issueDate;
	return date ? `desde ${monthYearShort(date)}` : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Movimentações
// ---------------------------------------------------------------------------------------------------------------------

export interface MovementRow {
	id: string;
	title: string;
	date: string;
	value: string;
	/** Aplicação entra na posição (neutro); saída em vermelho não: resgate e imposto são só texto com sinal. */
	kind: InvestmentMovementDto["kind"];
}

const MOVEMENT_TITLES: Record<string, string> = {
	TAX: "Imposto",
	INCOME_TAX: "Imposto (IR)",
	IOF: "IOF",
	INCOME: "Rendimento",
	DIVIDEND: "Dividendo",
	TRANSFER: "Transferência",
	FEE: "Taxa",
};

export function movementTitle(
	m: Pick<InvestmentMovementDto, "kind" | "movementType" | "type" | "description">,
): string {
	if (m.kind === "contribution") return "Aplicação";
	if (m.kind === "withdrawal") return "Resgate";
	const key = (m.movementType ?? m.type ?? "").toUpperCase();
	return MOVEMENT_TITLES[key] ?? m.description?.trim() ?? "Movimentação";
}

const NEGATIVE_OTHER = new Set(["TAX", "INCOME_TAX", "IOF", "FEE"]);

export function movementRow(m: InvestmentMovementDto, hidden: boolean): MovementRow {
	const day = m.date ?? m.tradeDate;
	const key = (m.movementType ?? m.type ?? "").toUpperCase();
	const negative = m.kind === "withdrawal" || (m.kind === "other" && NEGATIVE_OTHER.has(key));
	const cents = m.amountCents;
	return {
		id: m.id,
		title: movementTitle(m),
		date: day ? dayMonth(day) : "",
		value:
			cents === null ? "sem valor" : money(negative ? -Math.abs(cents) : cents, hidden, { sign: "auto" }),
		kind: m.kind,
	};
}

// ---------------------------------------------------------------------------------------------------------------------
// Evolução
// ---------------------------------------------------------------------------------------------------------------------

const DAY_MS = 86_400_000;

/** Dias desde 1970 para "2026-11-07"; só para posicionar pontos no eixo (geometria, não dinheiro). */
export function dayNumber(day: string): number {
	return Math.round(
		Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) / DAY_MS,
	);
}

export interface ChartXY {
	x: number;
	y: number;
}

export interface EvolutionChart {
	/** Trechos contínuos do patrimônio: um dia incompleto quebra a linha em vez de ser ligado por cima. */
	balanceRuns: ChartXY[][];
	/** Trechos do aplicado: quebram também onde `investedComplete` é falso (buraco, não ligar por cima). */
	investedRuns: ChartXY[][];
	/** Pontos em x em dias desde o primeiro; y em centavos já sem o chão do gráfico. */
	xMax: number;
	yMax: number;
	/** Rótulos do eixo: um por mês que aparece, com a posição (0..1) na largura. */
	ticks: { label: string; at: number }[];
	/** Dias em que o ponto estava incompleto (posição fora da soma): a linha não passa por eles. */
	hiddenDays: number;
	/** Há pontos, mas todos incompletos: não é "sem histórico". */
	onlyIncomplete: boolean;
	/** O patrimônio do último dia COMPLETO e o dia dele (pode não ser hoje). */
	lastBalanceCents: number | null;
	lastBalanceDay: string | null;
	/** "em 8 de nov": a data do número grande, sem sugerir que é hoje. */
	lastBalanceLabel: string | null;
	/** Algum ponto usa aplicado estimado pelas movimentações. */
	investedEstimated: boolean;
	/** "de 12 de jun a 10 de nov". */
	span: string | null;
}

const incomplete = (p: InvestmentEvolutionPointDto) => p.missingPositions > 0;

const EMPTY_CHART: EvolutionChart = {
	balanceRuns: [],
	investedRuns: [],
	xMax: 0,
	yMax: 0,
	ticks: [],
	hiddenDays: 0,
	onlyIncomplete: false,
	lastBalanceCents: null,
	lastBalanceDay: null,
	lastBalanceLabel: null,
	investedEstimated: false,
	span: null,
};

/**
 * Prepara a linha: dias incompletos (`missingPositions > 0`) subestimam o patrimônio, então a linha não os liga, e o
 * aplicado só entra onde `investedComplete` (o buraco quebra a linha). Sem inventar pontos: dia sem retrato não aparece.
 */
export function evolutionChart(res: InvestmentEvolutionResponse): EvolutionChart {
	const points = res.points;
	const first = points[0];
	const last = points.at(-1);
	if (!first || !last) return EMPTY_CHART;
	const origin = dayNumber(first.day);
	const xMax = Math.max(1, dayNumber(last.day) - origin);
	const balanceRuns: ChartXY[][] = [];
	const investedRuns: ChartXY[][] = [];
	let balanceRun: ChartXY[] | null = null;
	let investedRun: ChartXY[] | null = null;
	let hidden = 0;
	let yMax = 0;
	let yMin = Number.POSITIVE_INFINITY;
	let investedEstimated = false;
	for (const p of points) {
		if (incomplete(p)) {
			hidden++;
			balanceRun = null;
			investedRun = null;
			continue;
		}
		const x = dayNumber(p.day) - origin;
		if (!balanceRun) {
			balanceRun = [];
			balanceRuns.push(balanceRun);
		}
		balanceRun.push({ x, y: p.balanceCents });
		if (p.investedComplete) {
			if (!investedRun) {
				investedRun = [];
				investedRuns.push(investedRun);
			}
			investedRun.push({ x, y: p.investedCents });
			if (p.investedEstimated) investedEstimated = true;
		} else {
			investedRun = null;
		}
		const values = p.investedComplete ? [p.balanceCents, p.investedCents] : [p.balanceCents];
		yMax = Math.max(yMax, ...values);
		yMin = Math.min(yMin, ...values);
	}
	// A linha não parte do zero (ficaria reta): o chão do gráfico fica um pouco abaixo do menor valor. É só escala,
	// o gráfico não tem números no eixo.
	const floor = Math.max(0, yMin === Number.POSITIVE_INFINITY ? 0 : yMin - Math.round((yMax - yMin) * 0.25));
	for (const run of [...balanceRuns, ...investedRuns]) for (const point of run) point.y -= floor;
	yMax -= floor;
	const ticks: EvolutionChart["ticks"] = [];
	let lastMonth = "";
	for (const p of points) {
		const month = p.day.slice(0, 7);
		if (month === lastMonth) continue;
		lastMonth = month;
		ticks.push({ label: monthShort(month), at: (dayNumber(p.day) - origin) / xMax });
	}
	const lastComplete = [...points].reverse().find((p) => !incomplete(p));
	return {
		balanceRuns,
		investedRuns,
		xMax,
		yMax,
		ticks,
		hiddenDays: hidden,
		onlyIncomplete: balanceRuns.length === 0,
		lastBalanceCents: lastComplete?.balanceCents ?? null,
		lastBalanceDay: lastComplete?.day ?? null,
		lastBalanceLabel: lastComplete ? `em ${dayMonth(lastComplete.day)}` : null,
		investedEstimated,
		span: first.day === last.day ? dayMonth(first.day) : `de ${dayMonth(first.day)} a ${dayMonth(last.day)}`,
	};
}

/** Os retratos diários de UMA posição no mesmo formato da evolução, para reaproveitar a linha. */
export function snapshotsChart(snapshots: readonly InvestmentSnapshotDto[]): EvolutionChart {
	const points: InvestmentEvolutionPointDto[] = snapshots.map((s) => ({
		day: s.day,
		balanceCents: s.balanceCents,
		investedCents: s.investedCents ?? 0,
		investedEstimated: false,
		investedComplete: s.investedCents !== null,
		positions: 1,
		carriedPositions: 0,
		missingPositions: 0,
	}));
	const first = points[0];
	return evolutionChart({
		range: "6m",
		from: first?.day ?? "1970-01-01",
		to: points.at(-1)?.day ?? "1970-01-01",
		coveredFrom: first?.day ?? null,
		points,
		reason: null,
	});
}

export const RANGE_OPTIONS = [
	{ id: "1m", label: "1 mês" },
	{ id: "6m", label: "6 meses" },
	{ id: "1y", label: "1 ano" },
] as const;

export interface MonthBar {
	month: string;
	label: string;
	contributionsCents: number;
	/** `null` = sem rendimento para o mês (não desenha barra, não vira zero). */
	yieldCents: number | null;
	/** Cabeçalho do mês selecionado. */
	contribution: string;
	yieldText: string;
	yieldTone: YieldCard["tone"];
	/** Resgates do mês, quando houve. */
	withdrawal: string | null;
}

export function monthBars(months: readonly InvestmentMonthlyDto[], hidden: boolean): MonthBar[] {
	return months.map((m) => ({
		month: m.month,
		label: monthShort(m.month),
		contributionsCents: m.contributionsCents,
		yieldCents: m.yieldCents,
		contribution: money(m.contributionsCents, hidden, { sign: "never" }),
		yieldText:
			m.yieldCents === null
				? shortReason(m.yieldReason)
				: `${money(m.yieldCents, hidden, { sign: "always" })} de rendimento${m.yieldPartial ? " (parcial)" : ""}`,
		yieldTone: m.yieldCents === null ? "secondary" : yieldTone(m.yieldCents),
		withdrawal: m.withdrawalsCents > 0 ? money(m.withdrawalsCents, hidden, { sign: "never" }) : null,
	}));
}

/**
 * Altura de cada barra na MESMA escala (aportes e rendimento lado a lado). Geometria: o maior valor ocupa `max`, valor
 * positivo nunca some (mínimo `min`), zero e `null` não desenham. Valor negativo usa o tamanho do módulo.
 */
export function barHeights(values: readonly (number | null)[], max: number, min: number): number[] {
	const top = values.reduce<number>((a, v) => Math.max(a, v === null ? 0 : Math.abs(v)), 0);
	return values.map((v) => {
		if (v === null || v === 0 || top === 0) return 0;
		return Math.max(min, Math.round((Math.abs(v) / top) * max));
	});
}
