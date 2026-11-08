import { createHash } from "node:crypto";
import { invoiceFor, type LocalDate } from "@orbita/core";
import { DataError, type ImportSummary, type Stores } from "@orbita/db";
import { pickCategoryRule } from "@orbita/shared";
import { parseStatement } from "./parse.ts";
import type {
	NeedsMapping,
	ParseOptions,
	StatementFormat,
	StatementItem,
	UnrecognizedLine,
} from "./types.ts";

/*
 * Do extrato lido ao pendente gravado. Mesmo caminho nos dois passos do app: `previewStatement` (não grava nada) e
 * `importStatement` (grava como `pending` com origem `import`; quem confirma é a tela Para revisar). O arquivo em si
 * nunca é guardado: só o hash dele, para o mesmo arquivo não entrar duas vezes.
 */

export const IMPORT_SOURCE = "import" as const;
export const PREVIEW_ITEM_LIMIT = 200;
export const UNRECOGNIZED_LIMIT = 50;
/** Uma importação em andamento há mais que isto é de um processo que caiu: pode ser retomada. */
const STALE_AFTER_MS = 5 * 60_000;

export type ImportTarget = { accountId: string; cardId?: never } | { cardId: string; accountId?: never };

export interface ImportDeps {
	stores: Pick<Stores, "accounts" | "cards" | "transactions" | "imports" | "categoryRules">;
	now: () => Date;
}

export interface ImportRequest {
	bytes: Uint8Array;
	filename: string;
	target: ImportTarget;
	options?: Omit<ParseOptions, "sign">;
	/** Cria também as que parecem repetir um lançamento que já existe. Padrão: não. */
	includePossibleDuplicates?: boolean;
}

export type ItemStatus = "new" | "duplicate" | "possible_duplicate";

export interface PreviewItem {
	date: LocalDate;
	amountCents: number;
	description: string;
	status: ItemStatus;
}

export interface StatementPreview {
	status: "ok";
	format: StatementFormat;
	/** Quantos lançamentos o arquivo trouxe (entendidos). */
	total: number;
	/** Quantos seriam criados com as regras atuais. */
	toCreate: number;
	duplicates: number;
	possibleDuplicates: number;
	/** Cartão: entradas (pagamento de fatura, estorno) não são importadas. */
	creditsSkipped: number;
	period: { from: LocalDate; to: LocalDate } | null;
	/** Soma do que seria criado: entradas e saídas (saídas em valor positivo). */
	inCents: number;
	outCents: number;
	/** Os primeiros `PREVIEW_ITEM_LIMIT`. */
	items: PreviewItem[];
	unrecognized: UnrecognizedLine[];
	unrecognizedTotal: number;
	warnings: string[];
	/** O mesmo arquivo já foi importado para este destino. */
	alreadyImported: ImportSummary | null;
}

export type PreviewResult = StatementPreview | NeedsMapping;

export type ImportResult =
	| { status: "needs_mapping"; mapping: NeedsMapping }
	| { status: "imported"; summary: ImportSummary & { creditsSkipped: number }; warnings: string[] }
	| { status: "already_imported"; summary: ImportSummary }
	| { status: "in_progress" };

const targetKey = (t: ImportTarget) =>
	t.accountId !== undefined ? `account:${t.accountId}` : `card:${t.cardId}`;
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function checkTarget(deps: ImportDeps, target: ImportTarget): Promise<void> {
	const row =
		target.accountId !== undefined
			? await deps.stores.accounts.get(target.accountId)
			: await deps.stores.cards.get(target.cardId);
	const what = target.accountId !== undefined ? "A conta" : "O cartão";
	if (!row)
		throw new DataError("bad_reference", `${what} informad${what === "A conta" ? "a" : "o"} não existe.`);
	if (row.archivedAt) {
		throw new DataError(
			"bad_reference",
			`${what} informad${what === "A conta" ? "a" : "o"} está arquivad${what === "A conta" ? "a" : "o"}.`,
		);
	}
}

interface Classified {
	item: StatementItem;
	externalId: string;
	status: ItemStatus;
}

async function classify(
	deps: ImportDeps,
	target: ImportTarget,
	items: readonly StatementItem[],
): Promise<{ rows: Classified[]; creditsSkipped: number }> {
	const isCard = target.cardId !== undefined;
	// Cartão: entrada (pagamento de fatura, estorno) não vira lançamento aqui.
	const usable = items.filter((i) => !(isCard && i.amountCents > 0));
	const creditsSkipped = items.length - usable.length;
	const prefix = targetKey(target);
	const existing: LocalDate[] = [];
	const rows: Classified[] = [];
	for (const item of usable) {
		const externalId = `${prefix}:${item.externalId}`;
		const known = await deps.stores.transactions.existsByExternal(IMPORT_SOURCE, externalId);
		rows.push({ item, externalId, status: known ? "duplicate" : "new" });
		existing.push(item.date);
	}
	if (rows.length === 0) return { rows, creditsSkipped };

	// Possível duplicata: já existe algo da mesma conta/cartão, no mesmo dia, do mesmo valor e do mesmo tipo.
	const sorted = [...existing].sort();
	const found = await deps.stores.transactions.listByTarget(
		target.accountId !== undefined ? { accountId: target.accountId } : { cardId: target.cardId },
		{ from: sorted[0] as LocalDate, to: sorted.at(-1) as LocalDate },
	);
	const pool = new Map<string, number>();
	for (const t of found) {
		const key = `${t.date}|${t.kind === "income" ? t.amountCents : -t.amountCents}`;
		pool.set(key, (pool.get(key) ?? 0) + 1);
	}
	for (const row of rows) {
		if (row.status !== "new") continue;
		const key = `${row.item.date}|${row.item.amountCents}`;
		const left = pool.get(key) ?? 0;
		if (left > 0) {
			pool.set(key, left - 1);
			row.status = "possible_duplicate";
		}
	}
	return { rows, creditsSkipped };
}

function parseOptions(request: ImportRequest): ParseOptions {
	return { ...request.options, sign: request.target.cardId !== undefined ? "card" : "account" };
}

/** Lê o arquivo e diz o que aconteceria, sem gravar nada. */
export async function previewStatement(deps: ImportDeps, request: ImportRequest): Promise<PreviewResult> {
	await checkTarget(deps, request.target);
	const parsed = await parseStatement(request.bytes, request.filename, parseOptions(request));
	if (parsed.status === "needs_mapping") return parsed;

	const { rows, creditsSkipped } = await classify(deps, request.target, parsed.items);
	const count = (s: ItemStatus) => rows.filter((r) => r.status === s).length;
	const wanted = rows.filter(
		(r) => r.status === "new" || (request.includePossibleDuplicates && r.status === "possible_duplicate"),
	);
	const dates = rows.map((r) => r.item.date).sort();
	const batch = await deps.stores.imports.find(sha256(request.bytes), targetKey(request.target));
	return {
		status: "ok",
		format: parsed.format,
		total: rows.length,
		toCreate: wanted.length,
		duplicates: count("duplicate"),
		possibleDuplicates: count("possible_duplicate"),
		creditsSkipped,
		period: dates.length > 0 ? { from: dates[0] as LocalDate, to: dates.at(-1) as LocalDate } : null,
		inCents: wanted.filter((r) => r.item.amountCents > 0).reduce((s, r) => s + r.item.amountCents, 0),
		outCents: wanted.filter((r) => r.item.amountCents < 0).reduce((s, r) => s - r.item.amountCents, 0),
		items: rows.slice(0, PREVIEW_ITEM_LIMIT).map((r) => ({
			date: r.item.date,
			amountCents: r.item.amountCents,
			description: r.item.description,
			status: r.status,
		})),
		unrecognized: parsed.unrecognized.slice(0, UNRECOGNIZED_LIMIT),
		unrecognizedTotal: parsed.unrecognized.length,
		warnings: parsed.warnings,
		alreadyImported: batch?.summary ?? null,
	};
}

/** Grava o extrato como pendente (origem `import`). O mesmo arquivo para o mesmo destino não entra duas vezes. */
export async function importStatement(deps: ImportDeps, request: ImportRequest): Promise<ImportResult> {
	await checkTarget(deps, request.target);
	const parsed = await parseStatement(request.bytes, request.filename, parseOptions(request));
	if (parsed.status === "needs_mapping") return { status: "needs_mapping", mapping: parsed };

	const now = deps.now();
	const batch = await deps.stores.imports.begin({
		fileHash: sha256(request.bytes),
		targetKey: targetKey(request.target),
		format: parsed.format,
		now,
		staleBefore: new Date(now.getTime() - STALE_AFTER_MS),
	});
	if (batch.outcome === "existing") {
		return batch.batch.summary
			? { status: "already_imported", summary: batch.batch.summary }
			: { status: "in_progress" };
	}

	try {
		const { rows, creditsSkipped } = await classify(deps, request.target, parsed.items);
		const rules = await deps.stores.categoryRules.list();
		const cardConfig =
			request.target.cardId !== undefined ? await deps.stores.cards.getConfig(request.target.cardId) : null;
		const summary: ImportSummary = {
			created: 0,
			duplicates: rows.filter((r) => r.status === "duplicate").length,
			possibleDuplicates: rows.filter((r) => r.status === "possible_duplicate").length,
			unrecognized: parsed.unrecognized.length,
		};
		for (const row of rows) {
			if (row.status === "duplicate") continue;
			if (row.status === "possible_duplicate" && !request.includePossibleDuplicates) continue;
			const { item } = row;
			const rule = item.amountCents < 0 ? pickCategoryRule(rules, item.description) : null;
			const result = await deps.stores.transactions.upsertByExternal(IMPORT_SOURCE, row.externalId, {
				kind: item.amountCents < 0 ? "expense" : "income",
				amountCents: Math.abs(item.amountCents),
				date: item.date,
				description: item.description,
				status: "pending",
				categoryId: rule?.categoryId ?? null,
				...(request.target.accountId !== undefined
					? { accountId: request.target.accountId }
					: {
							cardId: request.target.cardId as string,
							invoiceMonth: invoiceFor(item.date, cardConfig as NonNullable<typeof cardConfig>).month,
						}),
			});
			// Corrida com outro envio: o outro criou primeiro; conta como repetido.
			if (result.created) summary.created++;
			else summary.duplicates++;
		}
		await deps.stores.imports.complete(batch.id, summary);
		return { status: "imported", summary: { ...summary, creditsSkipped }, warnings: parsed.warnings };
	} catch (error) {
		await deps.stores.imports.release(batch.id);
		throw error;
	}
}
