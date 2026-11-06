import { randomUUID } from "node:crypto";
import { monthOf } from "@orbita/core";
import type { TransactionSource } from "@orbita/shared";
import { MAX_INSTALLMENT_COUNT, TRANSACTION_SOURCES, transactionInvariantError } from "@orbita/shared";
import { DataError, invalid } from "./errors.ts";
import { applyPatch, cleanLocalDate } from "./rules.ts";
import type {
	InstallmentInput,
	TransactionCursor,
	TransactionData,
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

/** Completa os padrões e confere as invariantes. Lança `DataError("invalid")`. */
export function normalizeTransaction(input: TransactionInput): TransactionData {
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
	};
}

export function mergeTransaction(current: TransactionData, patch: TransactionPatch): TransactionData {
	return normalizeTransaction(applyPatch(current, patch));
}

/** Valida o grupo todo antes de gravar qualquer parcela e gera o id do grupo. */
export function normalizeInstallmentGroup(inputs: readonly InstallmentInput[]): TransactionData[] {
	if (inputs.length === 0) throw invalid("O parcelamento precisa de pelo menos uma parcela.");
	if (inputs.length > MAX_INSTALLMENT_COUNT) {
		throw invalid(`O parcelamento passa de ${MAX_INSTALLMENT_COUNT} parcelas.`);
	}
	const groupId = randomUUID();
	const rows = inputs.map((input) => normalizeTransaction({ ...input, installmentGroupId: groupId }));
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

export function checkRecentOptions(options: { limit: number; before?: TransactionCursor | undefined }): void {
	if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 500) {
		throw invalid("O limite deve ser um inteiro de 1 a 500.");
	}
	if (options.before) {
		cleanLocalDate(options.before.date, "A data do cursor");
		if (!options.before.id) throw invalid("O cursor precisa do id.");
	}
}

/** Ordem das listas de um mês/fatura: data, depois criação, depois id. */
export const byDateAsc = (a: TransactionRecord, b: TransactionRecord) =>
	a.date.localeCompare(b.date) || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);

/** Ordem de "recentes" e do cursor: data e id, do maior para o menor. */
export const byRecent = (a: TransactionRecord, b: TransactionRecord) =>
	b.date.localeCompare(a.date) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
