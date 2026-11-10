import { type LocalDate, toLocalDate } from "@orbita/core";
import type { InvestmentStore } from "@orbita/db";
import type { PluggyClient } from "./client.ts";
import {
	type InvestmentPosition,
	readInvestments,
	readInvestmentTransactions,
	toInvestmentMovement,
	toInvestmentPosition,
} from "./investments.ts";

/*
 * Grava os investimentos de UMA conexão: a posição de agora, o retrato do dia e as movimentações.
 *
 * - Nunca lança e nunca derruba o sync de contas e cartões: falha de leitura vira só uma nota. Conexão sem o produto
 *   (403/404 do Pluggy) não é erro nem nota.
 * - A posição que SUMIU da lista é arquivada (`archivedAt`), nunca apagada; `TOTAL_WITHDRAWAL` também arquiva (regra do
 *   store). Só se arquiva depois de uma leitura inteira: com linha descartada por formato, ou lista que falhou,
 *   nada é arquivado (a posição descartada pareceria "sumida").
 * - Retrato diário: o dia é o de America/Sao_Paulo e só se grava com saldo não nulo. Posição que JÁ estava arquivada
 *   não ganha retrato novo todo dia (saldo zero parado): o da passagem para encerrada fica registrado uma vez.
 * - Movimentações: a API não filtra por data, então vem a lista inteira e a idempotência é pelo id (o store regrava o
 *   que já existe). Posição já arquivada não tem as movimentações lidas de novo (não mudam).
 * - Texto do banco (nome, descrição) é dado: só é gravado e mostrado, nunca interpretado.
 */

export const INVESTMENT_SOURCE = "pluggy";

export interface InvestmentSyncResult {
	/** Posições gravadas nesta rodada (novas + atualizadas). */
	positions: number;
	/** Das gravadas, quantas eram novas. */
	created: number;
	/** Posições arquivadas por terem sumido da lista. */
	archived: number;
	/** Retratos do dia gravados. */
	snapshots: number;
	/** Movimentações novas e regravadas. */
	movementsCreated: number;
	movementsUpdated: number;
	/** Avisos (sem segredo, sem corpo de resposta). */
	notes: string[];
}

type InvestmentsClient = Pick<PluggyClient, "investments" | "investmentTransactions">;

const positionInput = (connectionId: string, p: InvestmentPosition) => ({
	source: INVESTMENT_SOURCE,
	externalId: p.externalId,
	connectionId,
	type: p.type,
	subtype: p.subtype,
	name: p.name,
	code: p.code,
	isin: p.isin,
	currency: p.currencyCode,
	status: p.status,
	balanceCents: p.balanceCents,
	grossCents: p.grossCents,
	investedCents: p.investedCents,
	profitCents: p.profitCents,
	withdrawableCents: p.withdrawableCents,
	incomeTaxCents: p.incomeTaxCents,
	financialTaxCents: p.financialTaxCents,
	quantity: p.quantity,
	unitValue: p.unitValue,
	rate: p.rate,
	rateType: p.rateType,
	fixedAnnualRate: p.fixedAnnualRate,
	annualRate: p.annualRate,
	lastMonthRate: p.lastMonthRate,
	lastTwelveMonthsRate: p.lastTwelveMonthsRate,
	positionDate: p.date,
	dueDate: p.dueDate,
	issueDate: p.issueDate,
	purchaseDate: p.purchaseDate,
	issuer: p.issuer,
});

export async function syncInvestments(
	deps: { client: InvestmentsClient; store: InvestmentStore; now: () => Date },
	connectionId: string,
): Promise<InvestmentSyncResult> {
	const { client, store } = deps;
	const out: InvestmentSyncResult = {
		positions: 0,
		created: 0,
		archived: 0,
		snapshots: 0,
		movementsCreated: 0,
		movementsUpdated: 0,
		notes: [],
	};
	const day: LocalDate = toLocalDate(deps.now());
	try {
		const read = await readInvestments(client, connectionId);
		if (read.outcome === "unavailable") return out;
		if (read.outcome === "error") {
			out.notes.push("Não consegui ler os investimentos desta vez.");
			return out;
		}
		if (read.dropped > 0) {
			out.notes.push(
				`${read.dropped} investimento(s) vieram do Pluggy fora do formato e não foram gravados.`,
			);
		}
		const positions = read.rows.map(toInvestmentPosition);
		let failedPositions = 0;
		let movementReadFailed = false;
		let movementSaveFailed = 0;
		let movementsDropped = 0;
		for (const p of positions) {
			let saved: Awaited<ReturnType<InvestmentStore["upsertPosition"]>>;
			try {
				saved = await store.upsertPosition(positionInput(connectionId, p));
			} catch {
				failedPositions++;
				continue;
			}
			out.positions++;
			if (saved.created) out.created++;
			const { record } = saved;
			// Já arquivada antes e ainda arquivada: nada de retrato diário nem de reler movimentações (não mudam).
			const stillArchived = saved.wasArchived && record.archivedAt !== null;
			try {
				if (p.balanceCents !== null && !stillArchived) {
					const snap = await store.upsertSnapshot(record.id, {
						day,
						balanceCents: p.balanceCents,
						grossCents: p.grossCents,
						investedCents: p.investedCents,
						quantity: p.quantity,
						unitValue: p.unitValue,
					});
					if (snap) out.snapshots++;
				}
			} catch {
				out.notes.push("Não deu para gravar o retrato do dia de um investimento.");
			}
			if (stillArchived) continue;
			const moves = await readInvestmentTransactions(client, p.externalId);
			if (moves.outcome === "unavailable") continue;
			if (moves.outcome === "error") {
				movementReadFailed = true;
				continue;
			}
			movementsDropped += moves.dropped;
			if (moves.rows.length === 0) continue;
			try {
				const r = await store.upsertMovements(record.id, moves.rows.map(toInvestmentMovement));
				out.movementsCreated += r.created;
				out.movementsUpdated += r.updated;
			} catch {
				movementSaveFailed++;
			}
		}
		if (failedPositions > 0) out.notes.push(`${failedPositions} investimento(s) não puderam ser gravados.`);
		if (movementReadFailed)
			out.notes.push("Não consegui ler as movimentações de alguns investimentos desta vez.");
		if (movementSaveFailed > 0)
			out.notes.push(`As movimentações de ${movementSaveFailed} investimento(s) não puderam ser gravadas.`);
		if (movementsDropped > 0)
			out.notes.push(
				`${movementsDropped} movimentação(ões) vieram do Pluggy fora do formato e não foram gravadas.`,
			);
		// Só uma leitura inteira prova que a posição sumiu.
		if (read.dropped === 0) {
			out.archived = await store.archiveMissing(
				INVESTMENT_SOURCE,
				connectionId,
				positions.map((p) => p.externalId),
			);
		}
	} catch {
		// Nunca derruba o sync de contas e cartões (sem detalhe: pode vir do banco ou do Pluggy).
		out.notes.push("Não deu para gravar os investimentos desta vez.");
	}
	return out;
}
