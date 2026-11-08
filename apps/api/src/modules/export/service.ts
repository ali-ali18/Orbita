import { DataError, type Stores, type TransactionRecord } from "@orbita/db";
import {
	EXPORT_DATASETS,
	type ExportDataset,
	type ExportFormat,
	type ExportQuery,
	type TRANSACTION_SOURCES,
} from "@orbita/shared";
import { toAccountDto } from "../accounts/dto.ts";
import { toCardDto } from "../cards/dto.ts";
import { toCategoryDto } from "../categories/dto.ts";
import { toRecurrenceDto } from "../recurrences/dto.ts";
import { toTransactionDto } from "../transactions/dto.ts";

export type ExportDeps = { stores: Stores; now: () => Date };

export type ExportFile = { body: string; filename: string; contentType: string };

/** Versão do formato do JSON: sobe se um campo mudar de lugar ou de sentido. */
export const EXPORT_SCHEMA_VERSION = 1;

const PAGE = 500;
const BOM = "﻿";
const SEPARATOR = ";";

/** Centavos inteiros → "-46,90" (decimal com vírgula, sinal ASCII; sem "R$", para a planilha ler como número). */
export function csvMoney(cents: number): string {
	if (!Number.isSafeInteger(cents)) throw new RangeError("valor em centavos inválido");
	const abs = Math.abs(cents);
	const body = `${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
	return cents < 0 ? `-${body}` : body;
}

/** Dinheiro já formatado por `csvMoney`: o sinal "-" é número, não fórmula, então não leva apóstrofo. */
type Money = { money: string };
type Cell = string | number | Money | null | undefined;

const money = (cents: number): Money => ({ money: csvMoney(cents) });

/**
 * Uma célula de CSV. Texto que começa com `= + - @` (ou tab/CR) vira fórmula no Excel e no Planilhas: descrição de
 * lançamento vem de fora (banco, extrato), então ganha um apóstrofo na frente. Aspas dobram; separador, aspas e
 * quebra de linha exigem aspas em volta.
 */
export function csvCell(value: Cell): string {
	if (value === null || value === undefined) return "";
	if (typeof value === "object") return value.money;
	let text = String(value);
	if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
	return /[;"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const csvLine = (cells: readonly Cell[]) => cells.map(csvCell).join(SEPARATOR);

/** BOM para o Excel reconhecer UTF-8; linhas com CRLF, como o Excel espera. */
function csvFile(header: readonly string[], rows: ReadonlyArray<readonly Cell[]>): string {
	return `${BOM}${[csvLine(header), ...rows.map(csvLine)].join("\r\n")}\r\n`;
}

const KIND_LABEL = {
	expense: "Saída",
	income: "Entrada",
	transfer: "Transferência",
	card_payment: "Pagamento de fatura",
	refund: "Estorno",
	investment: "Aplicação",
} as const;

const STATUS_LABEL = { pending: "Para revisar", confirmed: "Confirmado" } as const;

const SOURCE_LABEL: Record<(typeof TRANSACTION_SOURCES)[number], string> = {
	manual: "Manual",
	notification: "Notificação",
	pluggy: "Meu Pluggy",
	receipt: "Comprovante",
	import: "Extrato importado",
};

const ACCOUNT_KIND_LABEL = {
	checking: "Conta corrente",
	savings: "Poupança",
	wallet: "Carteira",
	investment: "Investimento",
} as const;

/** Saída, aplicação, pagamento de fatura: negativo. Entrada e estorno: positivo. Transferência fica como foi lançada (positivo). */
const signed = (t: Pick<TransactionRecord, "kind" | "amountCents">) =>
	t.kind === "expense" || t.kind === "card_payment" || t.kind === "investment"
		? -t.amountCents
		: t.amountCents;

/** Todos os lançamentos vivos do período, do mais recente para o mais antigo, página a página. */
async function allTransactions(stores: Stores, from?: string, to?: string): Promise<TransactionRecord[]> {
	const filter = { ...(from ? { from } : {}), ...(to ? { to } : {}) };
	const out: TransactionRecord[] = [];
	let before: { date: string; id: string } | undefined;
	for (;;) {
		const page = await stores.transactions.listRecent({ limit: PAGE, ...(before ? { before } : {}), filter });
		out.push(...page);
		const last = page.at(-1);
		if (page.length < PAGE || !last) return out;
		before = { date: last.date, id: last.id };
	}
}

/** Nome por id; arquivado (que a lista de ativos não traz) é buscado uma vez e guardado. */
function namer<T extends { id: string; name: string }>(
	all: readonly T[],
	get: (id: string) => Promise<T | null>,
) {
	const cache = new Map<string, string>(all.map((x) => [x.id, x.name]));
	return async (id: string | null): Promise<string> => {
		if (!id) return "";
		const hit = cache.get(id);
		if (hit !== undefined) return hit;
		const name = (await get(id))?.name ?? "";
		cache.set(id, name);
		return name;
	};
}

async function transactionsCsv(stores: Stores, query: ExportQuery): Promise<string> {
	const [rows, accounts, cards, categories] = await Promise.all([
		allTransactions(stores, query.from, query.to),
		stores.accounts.list(),
		stores.cards.list(),
		stores.categories.list(),
	]);
	const accountName = namer(accounts, (id) => stores.accounts.get(id));
	const cardName = namer(cards, (id) => stores.cards.get(id));
	const categoryName = namer(categories, (id) => stores.categories.get(id));
	const lines: Cell[][] = [];
	for (const t of rows) {
		lines.push([
			t.date,
			KIND_LABEL[t.kind],
			t.description,
			money(signed(t)),
			await categoryName(t.categoryId),
			await accountName(t.accountId),
			await accountName(t.counterpartAccountId),
			await cardName(t.cardId),
			t.invoiceMonth,
			t.installmentNumber !== null && t.installmentCount !== null
				? `${t.installmentNumber}/${t.installmentCount}`
				: "",
			STATUS_LABEL[t.status],
			SOURCE_LABEL[t.source],
			t.note,
		]);
	}
	return csvFile(
		[
			"Data",
			"Tipo",
			"Descrição",
			"Valor (R$)",
			"Categoria",
			"Conta",
			"Conta de destino",
			"Cartão",
			"Fatura",
			"Parcela",
			"Situação",
			"Origem",
			"Observação",
		],
		lines,
	);
}

async function categoriesCsv(stores: Stores): Promise<string> {
	const rows = await stores.categories.list();
	return csvFile(
		["Nome", "Identificador", "Do sistema"],
		rows.map((c) => [c.name, c.slug, c.isSystem ? "Sim" : "Não"]),
	);
}

async function accountsCsv(stores: Stores): Promise<string> {
	const [accounts, cards] = await Promise.all([stores.accounts.list(), stores.cards.list()]);
	return csvFile(
		["Tipo", "Nome", "Detalhe", "Limite (R$)"],
		[
			...accounts.map((a) => ["Conta", a.name, ACCOUNT_KIND_LABEL[a.kind], ""]),
			...cards.map((c) => [
				"Cartão",
				c.name,
				`Fecha dia ${c.closingDay}, vence dia ${c.dueDay}`,
				c.limitCents === null ? "" : money(c.limitCents),
			]),
		],
	);
}

async function subscriptionsCsv(stores: Stores): Promise<string> {
	const [rows, accounts, cards, categories] = await Promise.all([
		stores.recurrences.list(),
		stores.accounts.list(),
		stores.cards.list(),
		stores.categories.list(),
	]);
	const accountName = namer(accounts, (id) => stores.accounts.get(id));
	const cardName = namer(cards, (id) => stores.cards.get(id));
	const categoryName = namer(categories, (id) => stores.categories.get(id));
	const lines: Cell[][] = [];
	for (const r of rows) {
		lines.push([
			r.name,
			r.kind === "expense" ? "Saída" : "Entrada",
			money(r.kind === "expense" ? -r.amountCents : r.amountCents),
			r.dayOfMonth,
			r.startDate,
			r.endDate,
			await categoryName(r.categoryId),
			await accountName(r.accountId),
			await cardName(r.cardId),
		]);
	}
	return csvFile(
		["Nome", "Tipo", "Valor (R$)", "Dia do mês", "Início", "Fim", "Categoria", "Conta", "Cartão"],
		lines,
	);
}

const CSV_NAMES: Record<ExportDataset, string> = {
	transactions: "lancamentos",
	categories: "categorias",
	accounts: "contas-e-cartoes",
	subscriptions: "assinaturas",
};

const invalid = (message: string) => new DataError("invalid", message);

/**
 * Monta o arquivo de exportação. JSON: centavos inteiros, ids e tudo que a API já expõe (nunca chaves, tokens nem
 * aparelhos). CSV: um tipo de dado por arquivo, com dinheiro formatado. `now` só carimba o nome e o `exportedAt`.
 */
export async function buildExport({ stores, now }: ExportDeps, query: ExportQuery): Promise<ExportFile> {
	const include = query.include ?? (["transactions"] as ExportDataset[]);
	const stamp = now().toISOString();
	const day = stamp.slice(0, 10);
	const format: ExportFormat = query.format;

	if (format === "csv") {
		const [only, ...extra] = include;
		if (!only || extra.length > 0) {
			throw invalid("No CSV, escolha um tipo de dado por arquivo. Para levar tudo junto, use JSON.");
		}
		const body = {
			transactions: () => transactionsCsv(stores, query),
			categories: () => categoriesCsv(stores),
			accounts: () => accountsCsv(stores),
			subscriptions: () => subscriptionsCsv(stores),
		}[only]();
		return {
			body: await body,
			filename: `orbita-${CSV_NAMES[only]}-${day}.csv`,
			contentType: "text/csv; charset=utf-8",
		};
	}

	const data: Record<string, unknown> = {};
	for (const dataset of EXPORT_DATASETS) {
		if (!include.includes(dataset)) continue;
		if (dataset === "transactions") {
			data.transactions = (await allTransactions(stores, query.from, query.to)).map(toTransactionDto);
		} else if (dataset === "categories") {
			data.categories = (await stores.categories.list()).map(toCategoryDto);
		} else if (dataset === "accounts") {
			data.accounts = (await stores.accounts.list()).map(toAccountDto);
			data.cards = (await stores.cards.list()).map(toCardDto);
		} else {
			data.subscriptions = (await stores.recurrences.list()).map(toRecurrenceDto);
		}
	}
	const json = {
		app: "orbita",
		schemaVersion: EXPORT_SCHEMA_VERSION,
		exportedAt: stamp,
		/** Valores em centavos inteiros (`amountCents`, `limitCents`). */
		money: "cents",
		period: { from: query.from ?? null, to: query.to ?? null },
		...data,
	};
	return {
		body: `${JSON.stringify(json, null, 2)}\n`,
		filename: `orbita-${day}.json`,
		contentType: "application/json; charset=utf-8",
	};
}
