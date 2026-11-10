import { addDays, addMonths, clampDayInMonth, daysBetween, monthOf } from "./dates.ts";
import type { Cents, LocalDate, MonthKey } from "./types.ts";

/*
 * Engine de investimentos: tudo que a tela de Investimentos mostra como número sai daqui. Funções puras, centavos
 * inteiros, sem relógio (o "hoje" entra por parâmetro) e sem banco. O Pluggy só entrega a posição de AGORA (e
 * `amountProfit` vem nulo), então o rendimento é DERIVADO, e cada derivação diz se é exata ou estimada e por quê.
 * Ausente nunca vira zero: quando não dá para calcular, o resultado é `null` com o motivo em texto.
 */

// ---------------------------------------------------------------------------------------------------------------------
// Entradas (o `ledger` monta a partir das stores; o engine não conhece o banco)
// ---------------------------------------------------------------------------------------------------------------------

export interface InvestmentPositionInput {
	id: string;
	/** FIXED_INCOME, EQUITY, ETF, MUTUAL_FUND, SECURITY, COE, OTHER… (texto livre da fonte). */
	type: string | null;
	/** CDB, LCI, TREASURY, STOCK… */
	subtype: string | null;
	/** ACTIVE, PENDING, TOTAL_WITHDRAWAL… */
	status: string | null;
	currency: string | null;
	/** Saldo líquido atual. */
	balanceCents: Cents | null;
	/** Valor aplicado informado pelo banco (`amountOriginal`). */
	investedCents: Cents | null;
	/** Arquivada (sumiu da lista ou foi resgatada por inteiro). */
	archived: boolean;
	/** Datas de compra e de emissão (AAAA-MM-DD): evidência de que a posição foi aberta num mês. */
	purchaseDate?: LocalDate | null;
	issueDate?: LocalDate | null;
	/**
	 * As movimentações desta posição foram lidas por inteiro DEPOIS de ela fechar (o resgate final não pode estar
	 * faltando). Só com isso o ganho realizado de uma posição encerrada é estimado.
	 */
	movementsComplete?: boolean;
	/** O dia (America/Sao_Paulo) em que foi arquivada; a evolução não conta como "faltando" depois dele. */
	archivedDay?: LocalDate | null;
	/** A conexão que a trouxe foi removida: ninguém mais atualiza a posição. */
	connectionRemoved?: boolean;
	/** Chave e rótulo da instituição (a conexão), para agrupar. */
	institutionKey: string;
	institutionLabel: string;
}

export interface InvestmentMovementInput {
	investmentId: string;
	/** BUY, SELL, TAX, TRANSFER, INTEREST, AMORTIZATION. */
	type: string | null;
	date: LocalDate | null;
	tradeDate: LocalDate | null;
	amountCents: Cents | null;
	netAmountCents: Cents | null;
}

export interface InvestmentSnapshotInput {
	investmentId: string;
	day: LocalDate;
	balanceCents: Cents;
	investedCents: Cents | null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Classe e situação
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Classe de ativo. DECISÃO: o Tesouro Direto (TREASURY) fica DENTRO de "Renda fixa" (é título de renda fixa; o
 * subtipo "Tesouro Direto" continua visível na posição). ETF entra em "Ações" (negociado em bolsa como ação).
 * Fundos (inclusive imobiliários) ficam em "Fundos". O que não se reconhece vai para "Outros".
 */
export const INVESTMENT_CLASSES = ["fixed_income", "equity", "fund", "other"] as const;
export type InvestmentClass = (typeof INVESTMENT_CLASSES)[number];

export const INVESTMENT_CLASS_LABELS: Record<InvestmentClass, string> = {
	fixed_income: "Renda fixa",
	equity: "Ações",
	fund: "Fundos",
	other: "Outros",
};

const FIXED_INCOME_SUBTYPES = new Set([
	"CDB",
	"LCI",
	"LCA",
	"LC",
	"LF",
	"LIG",
	"CRI",
	"CRA",
	"DEBENTURE",
	"TREASURY",
]);
const EQUITY_SUBTYPES = new Set(["STOCK", "ETF", "BDR"]);

const norm = (v: string | null | undefined) => (v ?? "").trim().toUpperCase();

export function investmentClassOf(type: string | null, subtype: string | null): InvestmentClass {
	const t = norm(type);
	const s = norm(subtype);
	if (t === "FIXED_INCOME" || t === "TREASURY") return "fixed_income";
	if (t === "EQUITY" || t === "ETF") return "equity";
	if (t === "MUTUAL_FUND") return "fund";
	if (t === "" || t === "OTHER") {
		if (FIXED_INCOME_SUBTYPES.has(s)) return "fixed_income";
		if (EQUITY_SUBTYPES.has(s)) return "equity";
	}
	return "other";
}

const SUBTYPE_LABELS: Record<string, string> = {
	CDB: "CDB",
	LCI: "LCI",
	LCA: "LCA",
	LC: "LC",
	LF: "Letra financeira",
	LIG: "LIG",
	CRI: "CRI",
	CRA: "CRA",
	DEBENTURE: "Debênture",
	TREASURY: "Tesouro Direto",
	STOCK: "Ação",
	ETF: "ETF",
	BDR: "BDR",
	REAL_ESTATE_FUND: "Fundo imobiliário",
	INVESTMENT_FUND: "Fundo de investimento",
	MULTIMARKET_FUND: "Fundo multimercado",
	RETIREMENT: "Previdência",
};

/** Nome amigável do subtipo; `null` se não reconhecido (a tela usa o nome da posição). */
export function investmentSubtypeLabel(subtype: string | null): string | null {
	return SUBTYPE_LABELS[norm(subtype)] ?? null;
}

/** Situação que o banco usa para "resgatou tudo". */
export const INVESTMENT_CLOSED_STATUS = "TOTAL_WITHDRAWAL";

/** Ativa = não arquivada e não resgatada por inteiro. Só as ativas entram no patrimônio. */
export const isActiveInvestment = (p: Pick<InvestmentPositionInput, "archived" | "status">): boolean =>
	!p.archived && norm(p.status) !== INVESTMENT_CLOSED_STATUS;

/** Moeda vazia vale como BRL (o Pluggy omite); outra moeda NÃO se soma em reais. */
export const isBrlInvestment = (p: Pick<InvestmentPositionInput, "currency">): boolean => {
	const c = norm(p.currency);
	return c === "" || c === "BRL";
};

// ---------------------------------------------------------------------------------------------------------------------
// Movimentações
// ---------------------------------------------------------------------------------------------------------------------

interface Flow {
	/** "in" = aporte/compra (BUY); "out" = resgate/venda (SELL). */
	kind: "in" | "out";
	cents: Cents;
	/** Dia da operação (`date`, senão `tradeDate`); `null` = sem data. */
	day: LocalDate | null;
}

/**
 * Só BUY e SELL são fluxo de caixa da posição. TAX, INTEREST, AMORTIZATION e TRANSFER ficam de fora: juros e imposto
 * já estão no saldo (são rendimento, não aporte) e transferência/amortização não têm sentido garantido nas fontes.
 * O valor é o bruto da operação (`amount`); sem ele usa o com despesas (`netAmount`); sem nenhum, a linha não conta.
 */
function flowOf(m: InvestmentMovementInput): Flow | null {
	const t = norm(m.type);
	if (t !== "BUY" && t !== "SELL") return null;
	const raw = m.amountCents ?? m.netAmountCents;
	if (raw === null) return null;
	// Magnitude: o sentido vem só de BUY/SELL (algumas fontes mandam o SELL com valor negativo).
	return { kind: t === "BUY" ? "in" : "out", cents: Math.abs(raw), day: m.date ?? m.tradeDate };
}

/** BUY = aporte, SELL = resgate; o resto não é fluxo (juros, imposto, transferência, amortização). */
export function investmentMovementKind(type: string | null): "contribution" | "withdrawal" | "other" {
	const t = norm(type);
	return t === "BUY" ? "contribution" : t === "SELL" ? "withdrawal" : "other";
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
	const map = new Map<string, T[]>();
	for (const item of items) {
		const k = key(item);
		const list = map.get(k);
		if (list) list.push(item);
		else map.set(k, [item]);
	}
	return map;
}

function flowsByPosition(movements: readonly InvestmentMovementInput[]): Map<string, Flow[]> {
	const flows = new Map<string, Flow[]>();
	for (const m of movements) {
		const f = flowOf(m);
		if (f === null) continue;
		const list = flows.get(m.investmentId);
		if (list) list.push(f);
		else flows.set(m.investmentId, [f]);
	}
	return flows;
}

// ---------------------------------------------------------------------------------------------------------------------
// Rendimento de uma posição e da carteira (desde sempre)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * `invested`: saldo − valor aplicado informado pelo banco (exato). `movements`: saldo − (soma das compras − soma das
 * vendas), ESTIMADO (o histórico de movimentações pode estar incompleto e a nota pode ter despesas fora do valor).
 */
export type YieldBasis = "invested" | "movements" | "unavailable";

export interface PositionYield {
	/** Negativo = perda. `null` = não dá para calcular (veja `reason`). */
	cents: Cents | null;
	estimated: boolean;
	basis: YieldBasis;
	/** Quanto foi investido nesta conta (saldo − rendimento); base do percentual. `null` se não calculou. */
	basisCents: Cents | null;
	reason: string | null;
}

export const YIELD_REASONS = {
	noBalance: "sem saldo informado",
	noBasis: "sem valor aplicado e sem compras nas movimentações",
	partialRedemption: "houve resgate parcial; valor aproximado",
	redemptionOverInvested: "resgates maiores que o valor aplicado; sem como estimar",
	closedRealized: "posição encerrada; ganho realizado estimado pelas movimentações",
	closedUnknown: "posição encerrada: sem as movimentações completas para calcular o ganho",
	vanished: "a posição sumiu da lista do banco: sem saldo atual para calcular",
	connectionRemoved: "conexão removida: sem dados atuais para calcular",
	bankReduced: "o banco já reduziu o valor aplicado depois do resgate; valor aproximado",
	notSafe: "não deu para calcular com segurança",
} as const;

const unavailable = (reason: string): PositionYield => ({
	cents: null,
	estimated: false,
	basis: "unavailable",
	basisCents: null,
	reason,
});

function yieldOf(p: InvestmentPositionInput, flows: readonly Flow[]): PositionYield {
	let bought = 0;
	let sold = 0;
	let hasBuy = false;
	let hasSell = false;
	for (const f of flows) {
		if (f.kind === "in") {
			bought += f.cents;
			hasBuy = true;
		} else {
			sold += f.cents;
			hasSell = true;
		}
	}
	// Não ativa. `saldo − aplicado` seria "−aplicado" (o saldo é zero), então o que existe é o ganho REALIZADO, e só
	// para posição ENCERRADA de verdade (`TOTAL_WITHDRAWAL`, saldo zero), com as movimentações completas. Estimado: se o
	// histórico começou depois da compra, o realizado sai superestimado. Posição que só SUMIU da lista tem saldo
	// desconhecido (o último gravado é velho): sem número.
	if (!isActiveInvestment(p)) {
		if (p.connectionRemoved === true) return unavailable(YIELD_REASONS.connectionRemoved);
		if (norm(p.status) !== INVESTMENT_CLOSED_STATUS) return unavailable(YIELD_REASONS.vanished);
		if (p.movementsComplete === true && hasBuy && hasSell) {
			return {
				cents: sold - bought,
				estimated: true,
				basis: "movements",
				basisCents: bought,
				reason: YIELD_REASONS.closedRealized,
			};
		}
		return unavailable(YIELD_REASONS.closedUnknown);
	}
	if (p.balanceCents === null) return unavailable(YIELD_REASONS.noBalance);
	// `amountOriginal` zero ou negativo não é "aplicado" de verdade: trata como ausente.
	if (p.investedCents !== null && p.investedCents > 0) {
		if (!hasSell) {
			return {
				cents: p.balanceCents - p.investedCents,
				estimated: false,
				basis: "invested",
				basisCents: p.investedCents,
				reason: null,
			};
		}
		// Resgate parcial: o saldo já não carrega o que saiu, então `saldo − aplicado` seria perda falsa... a não ser que o
		// banco JÁ tenha reduzido o `amountOriginal` (aí subtrair o resgate de novo seria absurdo). Compara o aplicado
		// com a soma das compras: bem menor = o banco reduziu; igual (±1%) = não reduziu. Sem compra na lista não dá
		// para saber qual dos dois vale.
		if (!hasBuy) return unavailable(YIELD_REASONS.notSafe);
		const invested = p.investedCents;
		let base: number;
		let reason: string;
		if (invested * 100 < bought * 99) {
			base = invested;
			reason = YIELD_REASONS.bankReduced;
		} else if (invested * 100 <= bought * 101) {
			if (sold >= invested) return unavailable(YIELD_REASONS.redemptionOverInvested);
			base = invested - sold;
			reason = YIELD_REASONS.partialRedemption;
		} else {
			return unavailable(YIELD_REASONS.notSafe);
		}
		const cents = p.balanceCents - base;
		// Rede de segurança: base minúscula perto do aplicado, ou mais de 100% de retorno numa renda fixa, é conta errada.
		if (
			base * 100 < invested ||
			(investmentClassOf(p.type, p.subtype) === "fixed_income" && Math.abs(cents) > base)
		) {
			return unavailable(YIELD_REASONS.notSafe);
		}
		return { cents, estimated: true, basis: "invested", basisCents: base, reason };
	}
	if (hasBuy) {
		const net = bought - sold;
		return {
			cents: p.balanceCents - net,
			estimated: true,
			basis: "movements",
			basisCents: net,
			reason: null,
		};
	}
	return unavailable(YIELD_REASONS.noBasis);
}

/** Rendimento de uma posição (ativa ou não): ver `YieldBasis`. */
export function positionYield(
	position: InvestmentPositionInput,
	movements: readonly InvestmentMovementInput[],
): PositionYield {
	return yieldOf(
		position,
		movements.flatMap((m) => {
			if (m.investmentId !== position.id) return [];
			const f = flowOf(m);
			return f ? [f] : [];
		}),
	);
}

export interface PortfolioYield {
	/** Soma dos rendimentos das posições ATIVAS que deu para calcular. `null` se nenhuma deu. */
	cents: Cents | null;
	/** Alguma parcela é estimada (veja `YieldBasis`). */
	estimated: boolean;
	/** Posições ativas incluídas na soma e quantas ficaram de fora (sem como calcular). */
	countedPositions: number;
	missingPositions: number;
	/** Quanto foi investido nas posições incluídas; base do percentual. */
	basisCents: Cents | null;
	/** Rendimento ÷ base em pontos-base (100 = 1%), arredondado; `null` se a base não é positiva. */
	returnBps: number | null;
	reason: string | null;
}

/** Divisão inteira arredondada para o mais próximo (metade para longe de zero), sem float. */
export function roundedDiv(numerator: number, denominator: number): number {
	if (denominator === 0) throw new RangeError("divisão por zero");
	const sign = numerator < 0 !== denominator < 0 ? -1 : 1;
	const n = Math.abs(numerator);
	const d = Math.abs(denominator);
	return sign * Math.floor((2 * n + d) / (2 * d));
}

/**
 * Rendimento total da carteira ATIVA. Posição resgatada por inteiro não entra: com o histórico de movimentações
 * (que pode ser parcial) o "ganho realizado" dela não é confiável. Cada posição incompleta fica de fora e é contada
 * em `missingPositions`: o número é o que se sabe, nunca um palpite.
 */
export function portfolioYield(
	positions: readonly InvestmentPositionInput[],
	movements: readonly InvestmentMovementInput[],
): PortfolioYield {
	const flows = flowsByPosition(movements);
	let cents = 0;
	let basis = 0;
	let counted = 0;
	let missing = 0;
	let estimated = false;
	for (const p of positions) {
		if (!isActiveInvestment(p) || !isBrlInvestment(p)) continue;
		const y = yieldOf(p, flows.get(p.id) ?? []);
		if (y.cents === null || y.basisCents === null) {
			missing++;
			continue;
		}
		counted++;
		cents += y.cents;
		basis += y.basisCents;
		if (y.estimated) estimated = true;
	}
	if (counted === 0) {
		return {
			cents: null,
			estimated: false,
			countedPositions: 0,
			missingPositions: missing,
			basisCents: null,
			returnBps: null,
			reason: missing > 0 ? "sem valor aplicado nem compras para calcular" : "sem posições ativas",
		};
	}
	return {
		cents,
		estimated,
		countedPositions: counted,
		missingPositions: missing,
		basisCents: basis,
		returnBps: basis > 0 ? roundedDiv(cents * 10000, basis) : null,
		reason: null,
	};
}

// ---------------------------------------------------------------------------------------------------------------------
// Retratos (snapshots) e rendimento do mês
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Quantos dias um retrato pode estar defasado em relação ao ponto que ele representa (início ou fim do mês) e ainda
 * valer. Cobre fim de semana e um sync perdido; passou disso, a posição fica de fora do cálculo em vez de chutar.
 * Saldo ZERO não tem prazo: posição vazia continua vazia.
 */
export const SNAPSHOT_TOLERANCE_DAYS = 5;

function sortedSnapshots(
	snapshots: readonly InvestmentSnapshotInput[],
): Map<string, InvestmentSnapshotInput[]> {
	const map = groupBy(snapshots, (s) => s.investmentId);
	for (const list of map.values()) list.sort((a, b) => a.day.localeCompare(b.day));
	return map;
}

/** O retrato mais recente em `day` ou antes, se ainda vale (ver `SNAPSHOT_TOLERANCE_DAYS`). */
function snapshotAt(list: readonly InvestmentSnapshotInput[] | undefined, day: LocalDate) {
	let found: InvestmentSnapshotInput | null = null;
	for (const s of list ?? []) {
		if (s.day > day) break;
		found = s;
	}
	if (found === null) return null;
	if (found.balanceCents === 0 || daysBetween(found.day, day) <= SNAPSHOT_TOLERANCE_DAYS) return found;
	return null;
}

export interface PeriodYield {
	month: MonthKey;
	/**
	 * Variação do saldo no mês descontando aportes e resgates (BUY e SELL) do mês, somada das posições com ponto de
	 * partida e de chegada conhecidos. `null` = não dá para calcular (veja `reason`).
	 */
	cents: Cents | null;
	/** Posições incluídas e posições que existiam mas não têm retrato do início/fim (ficaram de fora). */
	countedPositions: number;
	missingPositions: number;
	/** O retrato de partida mais antigo usado (a medição cobre dali em diante). `null` se nenhum. */
	baselineDay: LocalDate | null;
	reason: string | null;
}

export const NO_HISTORY_REASON = "sem histórico ainda";
export const CLOSE_NOT_READ_REASON = "resgate ainda não lido nas movimentações";

/** Quanto o saldo pode destoar de compras − vendas (20%) para valer como "posição aberta neste período". */
const OPENING_COHERENCE_FACTOR = 5;

/**
 * Rendimento de um mês (`month` = "AAAA-MM"). Para o mês corrente o ponto de chegada é o saldo de agora; para mês
 * passado, o retrato do fim do mês. O ponto de partida é o retrato do fim do mês anterior (`SNAPSHOT_TOLERANCE_DAYS`).
 *
 * - Um retrato de um dia vale como o saldo de ANTES das movimentações daquele dia (o Meu Pluggy atualiza a cada 24 h e
 *   o sync roda cedo): entram na conta as movimentações de `[dia do retrato de partida, dia do retrato de chegada)`.
 *   Assim os meses se encaixam sem contar uma movimentação duas vezes ou nenhuma. Para o mês corrente, "hoje" não entra.
 * - Posição aberta no próprio mês parte de zero, mas só com EVIDÊNCIA: `purchaseDate` no mês (ou, sem ela,
 *   `issueDate` no mês, ou saldo coerente com compras − vendas em ±20%). O histórico de movimentações pode ser só dos
 *   últimos meses, e "primeira movimentação no mês" sozinha erraria numa posição antiga.
 * - Posição sem ponto de partida NÃO entra (não se inventa histórico). Posição cujo saldo foi a zero sem nenhum SELL no
 *   período também não entra: o resgate pode não ter sido lido ainda, e contar o saldo que sumiu como perda seria falso.
 * - Sem nenhuma posição incluída o resultado é `null` com o motivo.
 * Rendimento = saldo final − saldo inicial − (compras − vendas) do período.
 */
export function monthYield(input: {
	positions: readonly InvestmentPositionInput[];
	movements: readonly InvestmentMovementInput[];
	snapshots: readonly InvestmentSnapshotInput[];
	month: MonthKey;
	today: LocalDate;
}): PeriodYield {
	const { positions, movements, snapshots, month, today } = input;
	const live = month === monthOf(today);
	const monthStart: LocalDate = `${month}-01`;
	const prevEnd = addDays(monthStart, -1);
	const endDay = live ? today : clampDayInMonth(month, 31);
	const flows = flowsByPosition(movements);
	const snaps = sortedSnapshots(snapshots);
	const inPeriod = (d: LocalDate | null | undefined) => d != null && d > prevEnd && d <= endDay;

	let cents = 0;
	let counted = 0;
	let missing = 0;
	let missingNoHistory = 0;
	let baselineDay: LocalDate | null = null;
	for (const p of positions) {
		if (!isBrlInvestment(p)) continue;
		const own = snaps.get(p.id);
		const ownFlows = flows.get(p.id) ?? [];
		const dated = ownFlows.filter((f) => f.day !== null) as (Flow & { day: LocalDate })[];
		const firstFlowDay = dated.reduce<LocalDate | null>(
			(min, f) => (min === null || f.day < min ? f.day : min),
			null,
		);

		// Ponto de chegada. Só "resgatou tudo" (TOTAL_WITHDRAWAL) garante saldo zero: posição que SUMIU da lista (arquivada
		// com outra situação) tem saldo desconhecido, e dizer zero viraria uma perda inventada.
		let end: Cents | null;
		let endBound: LocalDate = endDay;
		if (live) {
			const closed = norm(p.status) === INVESTMENT_CLOSED_STATUS;
			end = isActiveInvestment(p) ? p.balanceCents : closed ? 0 : null;
			endBound = today;
		} else {
			const s = snapshotAt(own, endDay);
			end = s ? s.balanceCents : null;
			if (s) endBound = s.day;
		}

		// Ponto de partida.
		let start: { day: LocalDate; cents: Cents } | null = null;
		const base = snapshotAt(own, prevEnd);
		if (base) start = { day: base.day, cents: base.balanceCents };
		else if (!own?.some((s) => s.day <= prevEnd) && firstFlowDay !== null && inPeriod(firstFlowDay)) {
			let net = 0;
			for (const f of dated) if (f.day <= endDay) net += f.kind === "in" ? f.cents : -f.cents;
			const coherent = end !== null && net > 0 && Math.abs(end - net) * OPENING_COHERENCE_FACTOR <= net;
			const opened = p.purchaseDate ? inPeriod(p.purchaseDate) : inPeriod(p.issueDate) || coherent;
			// Posição aberta neste período: parte de zero.
			if (opened) start = { day: monthStart, cents: 0 };
		}

		// Posição que ainda não existia no fim do período não conta (nem como "faltando").
		const existedByEnd =
			(own?.some((s) => s.day <= endDay) ?? false) || (firstFlowDay !== null && firstFlowDay <= endDay);
		if (!existedByEnd && !live) continue;
		if (start === null || end === null) {
			// Posição encerrada que não deixou rastro no período (nenhum retrato nem movimentação nele): nada a medir.
			const touched =
				(own?.some((s) => s.day > prevEnd && s.day <= endDay) ?? false) ||
				dated.some((f) => f.day > prevEnd && f.day <= endDay);
			if (!isActiveInvestment(p) && start === null && !touched) continue;
			missing++;
			missingNoHistory++;
			continue;
		}
		let net = 0;
		let sells = 0;
		for (const f of dated) {
			if (f.day >= start.day && f.day < endBound) {
				net += f.kind === "in" ? f.cents : -f.cents;
				if (f.kind === "out") sells++;
			}
		}
		if (end === 0 && sells === 0 && (start.cents > 0 || net > 0)) {
			missing++; // o saldo foi a zero (ou a posição abriu e fechou no período) sem o resgate nas movimentações
			continue;
		}
		cents += end - start.cents - net;
		counted++;
		if (baselineDay === null || start.day < baselineDay) baselineDay = start.day;
	}
	if (counted === 0) {
		return {
			month,
			cents: null,
			countedPositions: 0,
			missingPositions: missing,
			baselineDay: null,
			reason:
				missing === 0 ? "sem posições" : missingNoHistory > 0 ? NO_HISTORY_REASON : CLOSE_NOT_READ_REASON,
		};
	}
	return { month, cents, countedPositions: counted, missingPositions: missing, baselineDay, reason: null };
}

// ---------------------------------------------------------------------------------------------------------------------
// Aportes e rendimento por mês
// ---------------------------------------------------------------------------------------------------------------------

export interface MonthlyInvestment {
	month: MonthKey;
	/** Soma das compras/aplicações (BUY) do mês. */
	contributionsCents: Cents;
	/** Soma das vendas/resgates (SELL) do mês. */
	withdrawalsCents: Cents;
	/** Aportes − resgates. */
	netContributionsCents: Cents;
	/** Rendimento do mês (`monthYield`); `null` com motivo se faltam retratos. */
	yieldCents: Cents | null;
	yieldReason: string | null;
	/** O rendimento cobre só parte das posições (as outras não têm retrato). */
	yieldPartial: boolean;
}

/**
 * Os últimos `months` meses até o de `today` (do mais antigo ao mais novo). Aportes e resgates vêm só das
 * movimentações (exatos); o rendimento, dos retratos (`monthYield`): meses de antes do primeiro retrato ficam `null`.
 */
export function monthlyInvestments(input: {
	positions: readonly InvestmentPositionInput[];
	movements: readonly InvestmentMovementInput[];
	snapshots: readonly InvestmentSnapshotInput[];
	today: LocalDate;
	months: number;
}): MonthlyInvestment[] {
	const { positions, movements, snapshots, today, months } = input;
	if (!Number.isInteger(months) || months < 1) throw new RangeError("months deve ser um inteiro positivo");
	const brl = new Set(positions.filter(isBrlInvestment).map((p) => p.id));
	const current = monthOf(today);
	const totals = new Map<MonthKey, { in: Cents; out: Cents }>();
	for (const m of movements) {
		if (!brl.has(m.investmentId)) continue;
		const f = flowOf(m);
		if (f === null || f.day === null) continue;
		const key = monthOf(f.day);
		const t = totals.get(key) ?? { in: 0, out: 0 };
		if (f.kind === "in") t.in += f.cents;
		else t.out += f.cents;
		totals.set(key, t);
	}
	const out: MonthlyInvestment[] = [];
	for (let i = months - 1; i >= 0; i--) {
		const month = addMonths(current, -i);
		const t = totals.get(month) ?? { in: 0, out: 0 };
		const y = monthYield({ positions, movements, snapshots, month, today });
		out.push({
			month,
			contributionsCents: t.in,
			withdrawalsCents: t.out,
			netContributionsCents: t.in - t.out,
			yieldCents: y.cents,
			yieldReason: y.reason,
			yieldPartial: y.cents !== null && y.missingPositions > 0,
		});
	}
	return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Evolução (série diária dos retratos)
// ---------------------------------------------------------------------------------------------------------------------

export interface EvolutionPoint {
	day: LocalDate;
	/**
	 * Soma dos saldos do dia: o retrato daquele dia e, para a posição que não sincronizou, o último retrato dela (até
	 * `SNAPSHOT_TOLERANCE_DAYS` dias antes), para o gráfico não serrilhar.
	 */
	balanceCents: Cents;
	/**
	 * Soma do aplicado das posições do dia: o do retrato quando veio; senão (ação) compras − vendas até o dia, e aí
	 * `investedEstimated`. Posição sem como saber deixa `investedComplete` falso (a soma cobre só o que se sabe).
	 */
	investedCents: Cents;
	investedEstimated: boolean;
	investedComplete: boolean;
	/** Quantos retratos DO DIA compõem o ponto. */
	positions: number;
	/** Posições com saldo que entraram pelo retrato de um dia anterior (não sincronizaram neste dia). */
	carriedPositions: number;
	/** Posições conhecidas cujo último retrato é velho demais: ficaram FORA da soma (o ponto subestima o patrimônio). */
	missingPositions: number;
}

/**
 * Série dos dias com retrato entre `from` e `to` (inclusive). NÃO preenche dias faltantes: um dia sem sync simplesmente
 * não aparece. Num dia que aparece, a posição sem retrato dele carrega o último (ver `EvolutionPoint`). Retrato de
 * posição desconhecida (conexão removida) é ignorado.
 */
export function investmentEvolution(input: {
	positions: readonly InvestmentPositionInput[];
	movements: readonly InvestmentMovementInput[];
	snapshots: readonly InvestmentSnapshotInput[];
	from: LocalDate;
	to: LocalDate;
}): EvolutionPoint[] {
	const { positions, movements, snapshots, from, to } = input;
	const known = new Set(positions.filter(isBrlInvestment).map((p) => p.id));
	const flows = flowsByPosition(movements);
	const snaps = sortedSnapshots(snapshots.filter((s) => known.has(s.investmentId)));
	const archivedDayOf = new Map(positions.map((p) => [p.id, p.archivedDay ?? null]));
	const days = new Set<LocalDate>();
	for (const list of snaps.values()) for (const s of list) if (s.day >= from && s.day <= to) days.add(s.day);
	const points: EvolutionPoint[] = [];
	for (const day of [...days].sort()) {
		let balance = 0;
		let invested = 0;
		let estimated = false;
		let complete = true;
		let actual = 0;
		let carried = 0;
		let missing = 0;
		for (const [id, list] of snaps) {
			const exact = list.find((s) => s.day === day);
			const s = exact ?? snapshotAt(list, day);
			if (!s) {
				// Só conta como "faltando" quem ainda estava na lista naquele dia (não arquivada até então).
				const archivedDay = archivedDayOf.get(id);
				if (list.some((x) => x.day <= day) && !(archivedDay != null && archivedDay <= day)) missing++;
				continue;
			}
			if (exact) actual++;
			else if (s.balanceCents !== 0) carried++;
			balance += s.balanceCents;
			if (s.balanceCents === 0) continue; // posição vazia: nada aplicado
			if (s.investedCents !== null && s.investedCents > 0) {
				invested += s.investedCents;
				continue;
			}
			const own = (flows.get(id) ?? []).filter((f) => f.day !== null && f.day <= day);
			if (own.some((f) => f.kind === "in")) {
				for (const f of own) invested += f.kind === "in" ? f.cents : -f.cents;
				estimated = true;
			} else {
				complete = false;
			}
		}
		points.push({
			day,
			balanceCents: balance,
			investedCents: invested,
			investedEstimated: estimated,
			investedComplete: complete,
			positions: actual,
			carriedPositions: carried,
			missingPositions: missing,
		});
	}
	return points;
}

/** Meses de cada faixa da evolução. */
export const EVOLUTION_RANGE_MONTHS = { "1m": 1, "6m": 6, "1y": 12 } as const;
export type EvolutionRange = keyof typeof EVOLUTION_RANGE_MONTHS;

/** O primeiro dia da faixa: `today` menos N meses (dia 31 cai no último dia do mês curto). */
export function evolutionRangeStart(range: EvolutionRange, today: LocalDate): LocalDate {
	const month = addMonths(monthOf(today), -EVOLUTION_RANGE_MONTHS[range]);
	return clampDayInMonth(month, Number(today.slice(8, 10)));
}

// ---------------------------------------------------------------------------------------------------------------------
// Patrimônio e quebras
// ---------------------------------------------------------------------------------------------------------------------

export interface InvestmentGroup {
	key: string;
	label: string;
	balanceCents: Cents;
	/** Participação no patrimônio em pontos-base (10000 = 100%); a soma dos grupos fecha em 10000 (maior resto). */
	shareBps: number;
	positions: number;
}

export interface PortfolioBreakdown {
	/** Soma dos saldos das posições ativas em reais com saldo informado. */
	totalCents: Cents;
	/** Ativas em reais, com e sem saldo; as sem saldo não entram na soma. */
	activePositions: number;
	withoutBalance: number;
	/** Ativas em outra moeda: fora da soma (não se mistura moeda). */
	foreignCurrency: number;
	byClass: (InvestmentGroup & { class: InvestmentClass })[];
	byInstitution: InvestmentGroup[];
}

/** Reparte 10000 pontos-base pelos valores pelo método do maior resto (soma sempre 10000, se total > 0). */
export function shareBasisPoints(values: readonly number[]): number[] {
	const total = values.reduce((a, b) => a + b, 0);
	if (total <= 0) return values.map(() => 0);
	const exact = values.map((v) => (v * 10000) / total);
	const base = exact.map((x) => Math.floor(x));
	let left = 10000 - base.reduce((a, b) => a + b, 0);
	const order = exact
		.map((x, i) => ({ i, frac: x - Math.floor(x) }))
		.sort((a, b) => b.frac - a.frac || a.i - b.i);
	for (const { i } of order) {
		if (left <= 0) break;
		base[i] = (base[i] ?? 0) + 1;
		left--;
	}
	return base;
}

function groups(items: readonly { key: string; label: string; cents: Cents }[]): InvestmentGroup[] {
	const map = new Map<string, InvestmentGroup>();
	for (const it of items) {
		const g = map.get(it.key) ?? { key: it.key, label: it.label, balanceCents: 0, shareBps: 0, positions: 0 };
		g.balanceCents += it.cents;
		g.positions++;
		map.set(it.key, g);
	}
	const list = [...map.values()]
		.filter((g) => g.balanceCents > 0)
		.sort((a, b) => b.balanceCents - a.balanceCents || a.label.localeCompare(b.label));
	const shares = shareBasisPoints(list.map((g) => g.balanceCents));
	return list.map((g, i) => ({ ...g, shareBps: shares[i] ?? 0 }));
}

/** Patrimônio atual (soma dos saldos das posições ativas) e as quebras por classe e por instituição. */
export function portfolioBreakdown(positions: readonly InvestmentPositionInput[]): PortfolioBreakdown {
	const active = positions.filter(isActiveInvestment);
	const brl = active.filter(isBrlInvestment);
	// Saldo negativo não existe em investimento: dado ruim, fica fora do total E dos grupos (que só somam saldo positivo).
	const withBalance = brl.filter((p) => p.balanceCents !== null && p.balanceCents >= 0);
	const classes = groups(
		withBalance.map((p) => {
			const cls = investmentClassOf(p.type, p.subtype);
			return { key: cls, label: INVESTMENT_CLASS_LABELS[cls], cents: p.balanceCents as Cents };
		}),
	);
	return {
		totalCents: withBalance.reduce((sum, p) => sum + (p.balanceCents as Cents), 0),
		activePositions: brl.length,
		withoutBalance: brl.length - withBalance.length,
		foreignCurrency: active.length - brl.length,
		byClass: classes.map((g) => ({ ...g, class: g.key as InvestmentClass })),
		byInstitution: groups(
			withBalance.map((p) => ({
				key: p.institutionKey,
				label: p.institutionLabel,
				cents: p.balanceCents as Cents,
			})),
		),
	};
}
