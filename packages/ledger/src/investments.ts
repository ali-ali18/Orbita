import {
	addDays,
	EVOLUTION_RANGE_MONTHS,
	type EvolutionRange,
	evolutionRangeStart,
	INVESTMENT_CLASS_LABELS,
	type InvestmentMovementInput,
	type InvestmentPositionInput,
	type InvestmentSnapshotInput,
	investmentClassOf,
	investmentEvolution,
	investmentMovementKind,
	investmentSubtypeLabel,
	isActiveInvestment,
	type LocalDate,
	monthlyInvestments,
	monthOf,
	monthYield,
	NO_HISTORY_REASON,
	type PositionYield,
	portfolioBreakdown,
	portfolioYield,
	positionYield,
	roundedDiv,
	toLocalDate,
} from "@orbita/core";
import type {
	InvestmentMovementRecord,
	InvestmentRecord,
	InvestmentSnapshotRecord,
	Stores,
} from "@orbita/db";
import type {
	InvestmentDetailResponse,
	InvestmentEvolutionResponse,
	InvestmentMovementDto,
	InvestmentPositionDto,
	InvestmentsOverviewResponse,
	InvestmentYieldDto,
} from "@orbita/shared";
import { buildTermsFields, notApplicableTerms, resolveTerms } from "./investment-terms.ts";

/*
 * Leitura de Investimentos: junta as stores com o engine (`@orbita/core`) e devolve os DTOs de `@orbita/shared`
 * (`investments-api.ts`). Nada de conta aqui: o que parece conta (soma, divisão) é do engine.
 */

/** Meses de aportes/rendimento que o resumo devolve. */
export const INVESTMENT_MONTHLY_MONTHS = 6;
/** Leituras de movimentações depois do fechamento para confiar que estão completas (igual ao sync). */
const INVESTMENT_CLOSED_READS_ENOUGH = 2;

/** Nome que o app dá a conexão sem nome (mesma regra de `connectionName` no app). */
export const UNNAMED_INSTITUTION = "Banco novo";
const REMOVED_INSTITUTION = "Conexão removida";

const institutionLabel = (label: string | null | undefined): string => {
	const text = label?.trim() ?? "";
	return text === "" || /^meu\s*pluggy$/i.test(text) ? UNNAMED_INSTITUTION : text;
};

interface Loaded {
	records: InvestmentRecord[];
	positions: InvestmentPositionInput[];
	movements: InvestmentMovementRecord[];
	snapshots: InvestmentSnapshotRecord[];
}

/**
 * Carrega tudo que o engine precisa. Posição de uma conexão que foi REMOVIDA fica de fora (ou ficaria somando um
 * saldo que nunca mais será atualizado, e duplicaria o que a conexão nova que a substituiu traz).
 */
async function load(stores: Stores, only?: string): Promise<Loaded & { labels: Map<string, string> }> {
	const connections = await stores.pluggyConnections.list();
	const labels = new Map(connections.map((c) => [c.id, institutionLabel(c.label)]));
	const all = await stores.investments.list({ includeArchived: true });
	const records = all.filter((r) =>
		only !== undefined ? r.id === only : r.connectionId === null || labels.has(r.connectionId),
	);
	const ids = records.map((r) => r.id);
	const [movements, snapshots] =
		ids.length === 0
			? [[], []]
			: await Promise.all([
					stores.investments.listMovements({ investmentIds: ids }),
					stores.investments.listSnapshots({ investmentIds: ids }),
				]);
	return {
		records,
		positions: records.map((r) => toPositionInput(r, labels)),
		movements,
		snapshots,
		labels,
	};
}

function toPositionInput(r: InvestmentRecord, labels: ReadonlyMap<string, string>): InvestmentPositionInput {
	const key = r.connectionId ?? "sem-conexao";
	return {
		id: r.id,
		type: r.type,
		subtype: r.subtype,
		status: r.status,
		currency: r.currency,
		balanceCents: r.balanceCents,
		investedCents: r.investedCents,
		// Conexão removida: a posição não é mais atualizada por ninguém, então não vale como ativa (o detalhe ainda abre).
		archived: r.archivedAt !== null || (r.connectionId !== null && !labels.has(r.connectionId)),
		archivedDay: r.archivedAt === null ? null : toLocalDate(r.archivedAt),
		connectionRemoved: r.connectionId !== null && !labels.has(r.connectionId),
		purchaseDate: r.purchaseDate,
		issueDate: r.issueDate,
		// Encerrada com as movimentações relidas o bastante depois do fechamento: o resgate final não deve faltar.
		movementsComplete: r.archivedAt !== null && r.movementsClosedReads >= INVESTMENT_CLOSED_READS_ENOUGH,
		institutionKey: key,
		institutionLabel:
			r.connectionId === null ? UNNAMED_INSTITUTION : (labels.get(r.connectionId) ?? REMOVED_INSTITUTION),
	};
}

/**
 * Condições, sugestões e rendimento esperado de cada posição. Lê o que o dono informou e o CDI (só o trecho que as datas
 * de aplicação pedem) uma vez para todas as posições.
 */
async function termsContext(stores: Stores, records: readonly InvestmentRecord[], today: LocalDate) {
	const user = new Map((await stores.investmentTerms.list()).map((t) => [t.investmentId, t]));
	const starts = records.flatMap((r) => {
		const d = resolveTerms(r, user.get(r.id) ?? null, today).startDate?.date;
		return d === undefined ? [] : [d];
	});
	const earliest = starts.reduce<LocalDate | null>((min, d) => (min === null || d < min ? d : min), null);
	const cdi =
		earliest === null
			? []
			: (await stores.cdiRates.list({ from: addDays(earliest, -10), to: today })).map((c) => ({
					day: c.day,
					rateE8: c.rateE8,
				}));
	return (record: InvestmentRecord, input: InvestmentPositionInput) =>
		buildTermsFields({ record, input, user: user.get(record.id) ?? null, cdi, today });
}

const toMovementInput = (m: InvestmentMovementRecord): InvestmentMovementInput => ({
	investmentId: m.investmentId,
	type: m.type,
	date: m.date,
	tradeDate: m.tradeDate,
	amountCents: m.amountCents,
	netAmountCents: m.netAmountCents,
});

const toSnapshotInput = (s: InvestmentSnapshotRecord): InvestmentSnapshotInput => ({
	investmentId: s.investmentId,
	day: s.day,
	balanceCents: s.balanceCents,
	investedCents: s.investedCents,
});

function toYieldDto(y: PositionYield): InvestmentYieldDto {
	return {
		cents: y.cents,
		estimated: y.estimated,
		basis: y.basis,
		returnBps:
			y.cents !== null && y.basisCents !== null && y.basisCents > 0
				? roundedDiv(y.cents * 10000, y.basisCents)
				: null,
		reason: y.reason,
	};
}

export function toInvestmentPositionDto(
	record: InvestmentRecord,
	input: InvestmentPositionInput,
	movements: readonly InvestmentMovementInput[],
	terms: ReturnType<typeof notApplicableTerms> = notApplicableTerms(),
): InvestmentPositionDto {
	const cls = investmentClassOf(record.type, record.subtype);
	return {
		id: record.id,
		name: record.name,
		code: record.code,
		type: record.type,
		subtype: record.subtype,
		subtypeLabel: investmentSubtypeLabel(record.subtype),
		class: cls,
		classLabel: INVESTMENT_CLASS_LABELS[cls],
		status: record.status,
		active: isActiveInvestment(input),
		currency: record.currency,
		institutionKey: input.institutionKey,
		institutionLabel: input.institutionLabel,
		balanceCents: record.balanceCents,
		grossCents: record.grossCents,
		investedCents: record.investedCents,
		withdrawableCents: record.withdrawableCents,
		incomeTaxCents: record.incomeTaxCents,
		yield: toYieldDto(positionYield(input, movements)),
		quantity: record.quantity,
		unitValue: record.unitValue,
		rate: record.rate,
		rateType: record.rateType,
		fixedAnnualRate: record.fixedAnnualRate,
		positionDate: record.positionDate,
		dueDate: record.dueDate,
		issueDate: record.issueDate,
		purchaseDate: record.purchaseDate,
		issuer: record.issuer,
		syncedAt: record.syncedAt.toISOString(),
		archivedAt: record.archivedAt?.toISOString() ?? null,
		...terms,
	};
}

export const toInvestmentMovementDto = (m: InvestmentMovementRecord): InvestmentMovementDto => ({
	id: m.id,
	type: m.type,
	movementType: m.movementType,
	kind: investmentMovementKind(m.type),
	date: m.date,
	tradeDate: m.tradeDate,
	amountCents: m.amountCents,
	netAmountCents: m.netAmountCents,
	quantity: m.quantity,
	unitValue: m.unitValue,
	description: m.description,
});

/** `GET /v1/investments`: o resumo da carteira. */
export async function investmentsOverview(
	stores: Stores,
	clock: { today: LocalDate },
): Promise<InvestmentsOverviewResponse> {
	const { today } = clock;
	const { records, positions, movements, snapshots } = await load(stores);
	const movementInputs = movements.map(toMovementInput);
	const snapshotInputs = snapshots.map(toSnapshotInput);
	const byId = new Map(positions.map((p) => [p.id, p]));
	const termsOf = await termsContext(stores, records, today);
	const movementsOf = new Map<string, InvestmentMovementInput[]>();
	for (const m of movementInputs) {
		const list = movementsOf.get(m.investmentId);
		if (list) list.push(m);
		else movementsOf.set(m.investmentId, [m]);
	}

	const breakdown = portfolioBreakdown(positions);
	const total = portfolioYield(positions, movementInputs);
	const month = monthYield({
		positions,
		movements: movementInputs,
		snapshots: snapshotInputs,
		month: monthOf(today),
		today,
	});

	const active = records.filter((r) => isActiveInvestment(byId.get(r.id) as InvestmentPositionInput));
	const dtos = active
		.map((r) => {
			const input = byId.get(r.id) as InvestmentPositionInput;
			return toInvestmentPositionDto(r, input, movementsOf.get(r.id) ?? [], termsOf(r, input));
		})
		.sort(
			(a, b) => (b.balanceCents ?? -1) - (a.balanceCents ?? -1) || (a.name ?? "").localeCompare(b.name ?? ""),
		);
	const syncedAt = records.reduce<Date | null>(
		(latest, r) => (latest === null || r.syncedAt > latest ? r.syncedAt : latest),
		null,
	);

	return {
		asOf: today,
		hasData: records.length > 0,
		syncedAt: syncedAt?.toISOString() ?? null,
		totalCents: breakdown.totalCents,
		activePositions: breakdown.activePositions,
		withoutBalance: breakdown.withoutBalance,
		foreignCurrency: breakdown.foreignCurrency,
		missingTermsPositions: dtos.filter((d) => d.missing.length > 0).length,
		closedPositions: records.length - active.length,
		yield: {
			total: {
				cents: total.cents,
				estimated: total.estimated,
				returnBps: total.returnBps,
				countedPositions: total.countedPositions,
				missingPositions: total.missingPositions,
				reason: total.reason,
			},
			month: {
				month: month.month,
				cents: month.cents,
				partial: month.cents !== null && month.missingPositions > 0,
				countedPositions: month.countedPositions,
				missingPositions: month.missingPositions,
				baselineDay: month.baselineDay,
				reason: month.reason,
			},
		},
		byClass: breakdown.byClass,
		byInstitution: breakdown.byInstitution,
		positions: dtos,
		monthly: monthlyInvestments({
			positions,
			movements: movementInputs,
			snapshots: snapshotInputs,
			today,
			months: INVESTMENT_MONTHLY_MONTHS,
		}),
	};
}

/** `GET /v1/investments/:id`: a posição (também a encerrada), as movimentações e os retratos dela. `null` se não existe. */
export async function investmentDetail(
	stores: Stores,
	id: string,
	clock: { today: LocalDate },
): Promise<InvestmentDetailResponse | null> {
	const record = await stores.investments.get(id);
	if (!record) return null;
	const { positions, movements, snapshots } = await load(stores, id);
	const input = positions[0] as InvestmentPositionInput;
	const termsOf = await termsContext(stores, [record], clock.today);
	return {
		position: toInvestmentPositionDto(record, input, movements.map(toMovementInput), termsOf(record, input)),
		movements: movements.map(toInvestmentMovementDto),
		snapshots: snapshots.map((s) => ({
			day: s.day,
			balanceCents: s.balanceCents,
			investedCents: s.investedCents,
		})),
	};
}

/** `GET /v1/investments/evolution`: série diária dos retratos, sem preencher dias faltantes. */
export async function investmentEvolutionSeries(
	stores: Stores,
	range: EvolutionRange,
	clock: { today: LocalDate },
): Promise<InvestmentEvolutionResponse> {
	if (!(range in EVOLUTION_RANGE_MONTHS)) throw new RangeError("faixa inválida");
	const { today } = clock;
	const from = evolutionRangeStart(range, today);
	const { positions, movements, snapshots } = await load(stores);
	const points = investmentEvolution({
		positions,
		movements: movements.map(toMovementInput),
		snapshots: snapshots.map(toSnapshotInput),
		from,
		to: today,
	});
	const known = new Set(positions.map((p) => p.id));
	const coveredFrom = snapshots.reduce<LocalDate | null>(
		(min, s) => (known.has(s.investmentId) && (min === null || s.day < min) ? s.day : min),
		null,
	);
	return {
		range,
		from,
		to: today,
		coveredFrom,
		points,
		reason: points.length === 0 ? NO_HISTORY_REASON : null,
	};
}
