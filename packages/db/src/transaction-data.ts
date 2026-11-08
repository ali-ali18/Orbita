import { randomUUID } from "node:crypto";
import { monthOf } from "@orbita/core";
import type { TransactionSource } from "@orbita/shared";
import {
	cleanMerchantName,
	cleanSourceCategory,
	isLocalDate,
	MAX_INSTALLMENT_COUNT,
	TRANSACTION_KINDS,
	TRANSACTION_SOURCES,
	TRANSACTION_STATUSES,
	transactionFilterRangeError,
	transactionInvariantError,
} from "@orbita/shared";
import { DataError, invalid } from "./errors.ts";
import { applyPatch, cleanLocalDate } from "./rules.ts";
import type {
	InstallmentInput,
	TransactionCursor,
	TransactionData,
	TransactionFilter,
	TransactionInput,
	TransactionPatch,
	TransactionRecord,
} from "./transaction-store.ts";

export const REFUND_TARGET_MESSAGE = "O estorno deve apontar para uma despesa que existe.";
export const DUPLICATE_EXTERNAL_MESSAGE =
	"Já existe um lançamento desta origem com o mesmo identificador externo.";

export function duplicateExternal(): DataError {
	return new DataError("duplicate", DUPLICATE_EXTERNAL_MESSAGE);
}

function cleanExternal(source: TransactionSource, externalId: string | null | undefined): string | null {
	if (!TRANSACTION_SOURCES.includes(source)) throw invalid("Origem do lançamento inválida.");
	if (externalId === undefined || externalId === null) return null;
	const id = externalId.trim();
	if (id.length === 0 || id.length > 200)
		throw invalid("O identificador externo deve ter de 1 a 200 letras.");
	return id;
}

/** Uso interno: entrada com os campos de parcela, que só `createInstallmentGroup` preenche. */
export type TransactionDraft = TransactionInput & {
	installmentGroupId?: string | null;
	installmentNumber?: number | null;
	installmentCount?: number | null;
	categoryEditedByOwner?: boolean;
};

/** Lançamento avulso: campos de parcela que vierem (JS sem tipos) são descartados. */
export function normalizeTransaction(input: TransactionInput): TransactionData {
	return normalizeDraft({
		...input,
		installmentGroupId: null,
		installmentNumber: null,
		installmentCount: null,
	});
}

/** Completa os padrões e confere as invariantes. Lança `DataError("invalid")`. */
function normalizeDraft(input: TransactionDraft): TransactionData {
	const message = transactionInvariantError(input);
	if (message) throw invalid(message);
	const source = input.source ?? "manual";
	if (input.status !== undefined && input.status !== "pending" && input.status !== "confirmed") {
		throw invalid("Situação do lançamento inválida.");
	}
	return {
		kind: input.kind,
		amountCents: input.amountCents,
		date: input.date,
		description: input.description.trim(),
		categoryId: input.categoryId ?? null,
		accountId: input.accountId ?? null,
		cardId: input.cardId ?? null,
		counterpartAccountId: input.counterpartAccountId ?? null,
		refundOfId: input.refundOfId ?? null,
		budgetMonth: input.budgetMonth ?? monthOf(input.date),
		invoiceMonth: input.invoiceMonth ?? null,
		installmentGroupId: input.installmentGroupId ?? null,
		installmentNumber: input.installmentNumber ?? null,
		installmentCount: input.installmentCount ?? null,
		status: input.status ?? "confirmed",
		source,
		externalId: cleanExternal(source, input.externalId),
		note: input.note ?? null,
		sourceCategory: cleanSourceCategory(input.sourceCategory),
		merchantName: cleanMerchantName(input.merchantName),
		categoryEditedByOwner: input.categoryEditedByOwner === true,
	};
}

/** Parcela importada: avulsa + posição no grupo informada por quem importa. */
export function normalizeExternalInstallment(
	input: TransactionInput,
	installment: { groupId: string; number: number; count: number },
): TransactionData {
	if (installment.groupId.length === 0 || installment.groupId.length > 64)
		throw invalid("O identificador do parcelamento deve ter de 1 a 64 letras.");
	return normalizeDraft({
		...input,
		installmentGroupId: installment.groupId,
		installmentNumber: installment.number,
		installmentCount: installment.count,
	});
}

export const DUPLICATE_INSTALLMENT_MESSAGE = "O parcelamento já tem uma parcela com este número.";

const PATCHABLE = new Set([
	"kind",
	"amountCents",
	"date",
	"description",
	"categoryId",
	"accountId",
	"cardId",
	"counterpartAccountId",
	"refundOfId",
	"budgetMonth",
	"invoiceMonth",
	"status",
	"note",
	"categoryEditedByOwner",
]);

/**
 * Aplica o patch e revalida o lançamento inteiro. Trocar a data de um lançamento que não é
 * parcela e cujo mês do orçamento era o padrão leva o mês do orçamento junto.
 */
export function mergeTransaction(current: TransactionData, patch: TransactionPatch): TransactionData {
	for (const [key, value] of Object.entries(patch)) {
		if (value !== undefined && !PATCHABLE.has(key))
			throw invalid(`O campo ${key} do lançamento não pode ser alterado.`);
	}
	let effective: TransactionPatch = patch;
	if (
		patch.date !== undefined &&
		isLocalDate(patch.date) &&
		patch.date !== current.date &&
		patch.budgetMonth === undefined &&
		current.installmentGroupId === null &&
		current.budgetMonth === monthOf(current.date)
	) {
		effective = { ...patch, budgetMonth: monthOf(patch.date) };
	}
	return normalizeDraft(applyPatch<TransactionData>(current, effective));
}

/** Só as colunas que mudaram entre o lançamento atual e o resultado do patch. */
export function changedColumns(current: TransactionData, next: TransactionData): Partial<TransactionData> {
	const diff: Record<string, unknown> = {};
	for (const key of Object.keys(next) as Array<keyof TransactionData>) {
		if (next[key] !== current[key]) diff[key] = next[key];
	}
	return diff as Partial<TransactionData>;
}

/** Valida o grupo todo antes de gravar qualquer parcela e gera o id do grupo. */
export function normalizeInstallmentGroup(inputs: readonly InstallmentInput[]): TransactionData[] {
	if (inputs.length === 0) throw invalid("O parcelamento precisa de pelo menos uma parcela.");
	if (inputs.length > MAX_INSTALLMENT_COUNT) {
		throw invalid(`O parcelamento passa de ${MAX_INSTALLMENT_COUNT} parcelas.`);
	}
	const groupId = randomUUID();
	const rows = inputs.map((input) => normalizeDraft({ ...input, installmentGroupId: groupId }));
	const count = rows[0]?.installmentCount;
	const numbers = new Set<number>();
	for (const row of rows) {
		if (row.installmentCount !== count)
			throw invalid("Todas as parcelas devem ter o mesmo total de parcelas.");
		if (numbers.has(row.installmentNumber as number)) throw invalid("Há duas parcelas com o mesmo número.");
		numbers.add(row.installmentNumber as number);
	}
	const externals = rows.flatMap((r) => (r.externalId === null ? [] : [`${r.source}/${r.externalId}`]));
	if (new Set(externals).size !== externals.length) throw duplicateExternal();
	return rows;
}

/** O que o usuário pode editar e o banco guarda, sem id nem datas de controle. */
export function dataOf(record: TransactionRecord): TransactionData {
	const { id: _id, createdAt: _created, updatedAt: _updated, ...data } = record;
	return data;
}

export const refundTargetError = () => new DataError("bad_reference", REFUND_TARGET_MESSAGE);

export function cleanLimit(limit: number): number {
	if (!Number.isInteger(limit) || limit < 1 || limit > 500)
		throw invalid("O limite deve ser um inteiro de 1 a 500.");
	return limit;
}

export const DEFAULT_PENDING_LIMIT = 200;

/** Ids únicos de `getMany`; de 0 a 500 textos não vazios. */
export function cleanIds(ids: readonly string[]): string[] {
	if (!Array.isArray(ids) || ids.length > 500) throw invalid("Informe de 0 a 500 ids de lançamentos.");
	if (ids.some((id) => typeof id !== "string" || id.length === 0 || id.length > 64)) {
		throw invalid("Há um id de lançamento inválido.");
	}
	return [...new Set(ids)];
}

export function checkRecentOptions(options: {
	limit: number;
	before?: TransactionCursor | undefined;
	filter?: TransactionFilter | undefined;
}): void {
	cleanLimit(options.limit);
	if (options.filter) cleanFilter(options.filter);
	if (options.before) {
		cleanLocalDate(options.before.date, "A data do cursor");
		if (!options.before.id) throw invalid("O cursor precisa do id.");
	}
}

const FILTER_LIST_MAX = 50;

/** Confere o filtro de `listRecent` (a API já valida; a store não confia em quem a chama). */
export function cleanFilter(filter: TransactionFilter): void {
	const lists = [
		filter.kinds,
		filter.accountIds,
		filter.cardIds,
		filter.categoryIds,
		filter.sources,
		filter.statuses,
	];
	for (const list of lists) {
		if (list !== undefined && (!Array.isArray(list) || list.length > FILTER_LIST_MAX)) {
			throw invalid(`Uma lista de filtro aceita até ${FILTER_LIST_MAX} itens.`);
		}
	}
	for (const [list, valid] of [
		[filter.kinds, TRANSACTION_KINDS],
		[filter.sources, TRANSACTION_SOURCES],
		[filter.statuses, TRANSACTION_STATUSES],
	] as const) {
		if (list?.some((item) => !(valid as readonly string[]).includes(item))) {
			throw invalid("O filtro tem um valor inválido.");
		}
	}
	for (const ids of [filter.accountIds, filter.cardIds, filter.categoryIds]) {
		if (ids?.some((id) => typeof id !== "string" || id.length === 0 || id.length > 64)) {
			throw invalid("O filtro tem um id inválido.");
		}
	}
	if (filter.from !== undefined) cleanLocalDate(filter.from, "A data inicial");
	if (filter.to !== undefined) cleanLocalDate(filter.to, "A data final");
	for (const cents of [filter.minCents, filter.maxCents]) {
		if (cents !== undefined && (!Number.isInteger(cents) || cents < 0)) {
			throw invalid("Os valores do filtro devem ser centavos inteiros, sem negativo.");
		}
	}
	const range = transactionFilterRangeError(filter);
	if (range) throw invalid(range);
}

/** O lançamento passa no filtro? Mesma regra que a store Prisma monta em SQL (a em memória usa esta). */
export function matchesFilter(t: TransactionRecord, f: TransactionFilter): boolean {
	if (f.kinds?.length && !f.kinds.includes(t.kind)) return false;
	if (f.sources?.length && !f.sources.includes(t.source)) return false;
	if (f.statuses?.length && !f.statuses.includes(t.status)) return false;
	if (f.categoryIds?.length && (t.categoryId === null || !f.categoryIds.includes(t.categoryId))) return false;
	if (f.from !== undefined && t.date < f.from) return false;
	if (f.to !== undefined && t.date > f.to) return false;
	if (f.minCents !== undefined && t.amountCents < f.minCents) return false;
	if (f.maxCents !== undefined && t.amountCents > f.maxCents) return false;
	const accounts = f.accountIds?.length ? f.accountIds : null;
	const cards = f.cardIds?.length ? f.cardIds : null;
	if (accounts || cards) {
		const byAccount =
			accounts !== null &&
			((t.accountId !== null && accounts.includes(t.accountId)) ||
				(t.counterpartAccountId !== null && accounts.includes(t.counterpartAccountId)));
		const byCard = cards !== null && t.cardId !== null && cards.includes(t.cardId);
		if (!byAccount && !byCard) return false;
	}
	return true;
}

/** Ordem das listas de um mês/fatura: data, depois criação, depois id. */
export const byDateAsc = (a: TransactionRecord, b: TransactionRecord) =>
	a.date.localeCompare(b.date) || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);

/** Ordem de "recentes" e do cursor: data e id, do maior para o menor. */
export const byRecent = (a: TransactionRecord, b: TransactionRecord) =>
	b.date.localeCompare(a.date) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
