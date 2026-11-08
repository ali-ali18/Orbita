import { parseAmount } from "./amount.ts";
import { parseStatementDate } from "./date.ts";
import { withBankIds } from "./ids.ts";
import { cleanText, decodeBytes, excerpt, isBalanceLabel, plain } from "./text.ts";
import {
	type CsvMapping,
	type NeedsMapping,
	type ParsedStatement,
	type ParseOptions,
	StatementError,
	type UnrecognizedLine,
} from "./types.ts";

/*
 * CSV de bancos brasileiros (Nubank, Inter, Itaú, Bradesco, BB, Caixa, C6, Santander…). Cada banco usa um cabeçalho
 * e uma convenção: o parser acha o cabeçalho pelos NOMES das colunas (sem acento, sem caixa) e só segue quando
 * data, descrição e valor (ou saída/entrada) aparecem sem ambiguidade. Senão devolve `needs_mapping` e o app
 * pergunta ao dono qual coluna é qual.
 */

export const MAX_CSV_ROWS = 20_000;
const HEADER_SCAN_ROWS = 40;
const SAMPLE_ROWS = 5;
const DELIMITERS = [";", ",", "\t"] as const;

// ---------------------------------------------------------------- leitura

interface Row {
	/** Linha do arquivo onde o registro começa (1 = primeira). */
	line: number;
	cells: string[];
}

/** Divide em registros respeitando aspas (`""` é uma aspa; quebra de linha dentro de aspas fica na célula). */
export function splitRows(text: string, delimiter: string): Row[] {
	const rows: Row[] = [];
	let cells: string[] = [];
	let cell = "";
	let quoted = false;
	let line = 1;
	let startLine = 1;
	const endCell = () => {
		cells.push(cell);
		cell = "";
	};
	const endRow = () => {
		endCell();
		if (cells.some((c) => c.trim() !== "")) rows.push({ line: startLine, cells });
		cells = [];
	};
	for (let i = 0; i < text.length; i++) {
		const ch = text.charAt(i);
		if (quoted) {
			if (ch === '"') {
				if (text.charAt(i + 1) === '"') {
					cell += '"';
					i++;
				} else quoted = false;
			} else {
				if (ch === "\n") line++;
				cell += ch;
			}
			continue;
		}
		if (ch === '"' && cell.trim() === "") {
			quoted = true;
			cell = "";
		} else if (ch === delimiter) endCell();
		else if (ch === "\r" || ch === "\n") {
			if (ch === "\r" && text.charAt(i + 1) === "\n") i++;
			endRow();
			line++;
			startLine = line;
		} else cell += ch;
		if (rows.length > MAX_CSV_ROWS + HEADER_SCAN_ROWS) {
			throw new StatementError("too_large", "O arquivo tem linhas demais para importar de uma vez.");
		}
	}
	if (cell !== "" || cells.length > 0) endRow();
	return rows;
}

/** O separador com mais linhas de mesmo número de colunas (≥ 2) nas primeiras linhas; empate: `;`, `,`, tab. */
export function detectDelimiter(text: string): CsvMapping["delimiter"] {
	const head = text
		.split(/\r\n|\r|\n/)
		.slice(0, 60)
		.join("\n");
	let best: CsvMapping["delimiter"] = ";";
	let bestScore = 0;
	for (const delimiter of DELIMITERS) {
		const counts = new Map<number, number>();
		for (const row of splitRows(head, delimiter)) {
			if (row.cells.length >= 2) counts.set(row.cells.length, (counts.get(row.cells.length) ?? 0) + 1);
		}
		const score = Math.max(0, ...counts.values());
		if (score > bestScore) {
			best = delimiter;
			bestScore = score;
		}
	}
	return best;
}

// ------------------------------------------------------------ cabeçalho

type Role = "date" | "description" | "amount" | "debit" | "credit" | "id" | "balance";

/** Papel de uma coluna pelo nome. A ordem importa: saldo e data vencem "valor"/"lançamento". */
export function roleOf(header: string): Role | null {
	const h = plain(header);
	if (h === "") return null;
	if (/\b(saldo|balance)\b/.test(h)) return "balance";
	if (/\b(data|date|dt)\b/.test(h) && !/vencimento|fechamento/.test(h)) return "date";
	if (/\b(debito|debitos|saida|saidas)\b/.test(h)) return "debit";
	if (/\b(credito|creditos|entrada|entradas)\b/.test(h) && !/cartao/.test(h)) return "credit";
	if (/\b(valor|amount|value|quantia|montante)\b/.test(h) && !/\b(original|total|parcela)\b/.test(h))
		return "amount";
	if (/^(id|identificador|fitid)$|\b(identificador|id da transacao|codigo da transacao)\b/.test(h))
		return "id";
	if (
		/\b(descricao|historico|lancamento|title|titulo|estabelecimento|detalhes?|memo|nome|complemento|description|beneficiario|favorecido)\b/.test(
			h,
		)
	) {
		return "description";
	}
	return null;
}

interface Suggestion {
	date?: number;
	description: number[];
	amount?: number;
	debit?: number;
	credit?: number;
	externalId?: number;
	ambiguous: string | null;
}

function suggestFromHeader(headers: readonly string[]): Suggestion {
	const by = new Map<Role, number[]>();
	headers.forEach((h, i) => {
		const role = roleOf(h);
		if (role) by.set(role, [...(by.get(role) ?? []), i]);
	});
	const pick = (role: Role, exact: RegExp): { index?: number; ambiguous: boolean } => {
		const list = by.get(role) ?? [];
		if (list.length <= 1)
			return list[0] === undefined ? { ambiguous: false } : { index: list[0], ambiguous: false };
		const exacts = list.filter((i) => exact.test(plain(headers[i] as string)));
		return exacts.length === 1 ? { index: exacts[0] as number, ambiguous: false } : { ambiguous: true };
	};
	const date = pick("date", /^(data|date)$/);
	const amount = pick("amount", /^(valor|amount|value)( \(r\$\))?$/);
	const debit = pick("debit", /^(debito|saida)/);
	const credit = pick("credit", /^(credito|entrada)/);
	const id = pick("id", /^(id|identificador)$/);
	const ambiguous =
		[
			date.ambiguous && "data",
			amount.ambiguous && "valor",
			debit.ambiguous && "saída",
			credit.ambiguous && "entrada",
		].filter(Boolean)[0] ?? null;
	return {
		...(date.index === undefined ? {} : { date: date.index }),
		description: by.get("description") ?? [],
		...(amount.index === undefined ? {} : { amount: amount.index }),
		...(debit.index === undefined ? {} : { debit: debit.index }),
		...(credit.index === undefined ? {} : { credit: credit.index }),
		...(id.index === undefined ? {} : { externalId: id.index }),
		ambiguous: ambiguous ? `Há mais de uma coluna que parece ser "${ambiguous}".` : null,
	};
}

const complete = (s: Suggestion) =>
	s.date !== undefined &&
	s.description.length > 0 &&
	(s.amount !== undefined || (s.debit !== undefined && s.credit !== undefined)) &&
	s.ambiguous === null;

/** Procura, nas primeiras linhas, a que serve de cabeçalho (data + descrição + valor reconhecidos). */
function findHeader(rows: readonly Row[]): { index: number; suggestion: Suggestion } | null {
	for (let i = 0; i < Math.min(rows.length, HEADER_SCAN_ROWS); i++) {
		const suggestion = suggestFromHeader((rows[i] as Row).cells);
		if (complete(suggestion)) return { index: i, suggestion };
		// Cabeçalho reconhecido, mas ambíguo: o dono escolhe.
		if (suggestion.ambiguous && suggestion.date !== undefined && suggestion.description.length > 0) {
			return { index: i, suggestion };
		}
	}
	return null;
}

/** Sem cabeçalho: chuta pelo CONTEÚDO da primeira linha de dados (só como sugestão, o dono confirma). */
function suggestFromContent(row: readonly string[]): Suggestion {
	const date = row.findIndex((c) => parseStatementDate(c) !== null);
	const amount = row.findIndex((c, i) => i !== date && c.trim() !== "" && parseAmount(c) !== null);
	let description = -1;
	row.forEach((c, i) => {
		if (i === date || i === amount) return;
		if (c.trim().length > (row[description]?.trim().length ?? 0)) description = i;
	});
	return {
		...(date >= 0 ? { date } : {}),
		description: description >= 0 ? [description] : [],
		...(amount >= 0 ? { amount } : {}),
		ambiguous: null,
	};
}

function needsMapping(
	rows: readonly Row[],
	delimiter: CsvMapping["delimiter"],
	headerRow: number | null,
	suggestion: Suggestion,
	reason: string,
	namedColumns: boolean,
): NeedsMapping {
	const base = headerRow === null ? [] : (rows[headerRow]?.cells ?? []);
	const width = Math.max(base.length, ...rows.slice(0, 20).map((r) => r.cells.length));
	const columns = Array.from({ length: width }, (_, i) => {
		const name = namedColumns ? cleanText(base[i] ?? "", 40) : "";
		return name === "" ? `Coluna ${i + 1}` : name;
	});
	const first = headerRow === null ? 0 : headerRow + 1;
	const sample = rows.slice(first, first + SAMPLE_ROWS).map((r) => r.cells.map((c) => cleanText(c, 40)));
	const { ambiguous: _ambiguous, ...rest } = suggestion;
	return {
		status: "needs_mapping",
		format: "csv",
		delimiter,
		headerRow,
		columns,
		sample,
		suggested: {
			...(rest.date === undefined ? {} : { date: rest.date }),
			...(rest.description.length > 0 ? { description: rest.description } : {}),
			...(rest.amount === undefined ? {} : { amount: rest.amount }),
			...(rest.debit === undefined ? {} : { debit: rest.debit }),
			...(rest.credit === undefined ? {} : { credit: rest.credit }),
			...(rest.externalId === undefined ? {} : { externalId: rest.externalId }),
		},
		reason,
	};
}

// ----------------------------------------------------------------- linhas

function convertRows(rows: readonly Row[], mapping: CsvMapping, options: ParseOptions): ParsedStatement {
	const unrecognized: UnrecognizedLine[] = [];
	const warnings: string[] = [];
	const drafts: Array<{ date: string; amountCents: number; description: string; bankId: string | null }> = [];
	const first = mapping.headerRow === null ? 0 : mapping.headerRow + 1;
	const cardSign = options.sign === "card" ? -1 : 1;
	const flip = options.invertSign === true ? -1 : 1;
	let balances = 0;
	let dataRows = 0;

	for (const row of rows.slice(first)) {
		dataRows++;
		if (dataRows > MAX_CSV_ROWS) {
			throw new StatementError("too_large", "O arquivo tem linhas demais para importar de uma vez.");
		}
		const cell = (i: number | undefined) => (i === undefined ? "" : (row.cells[i] ?? "").trim());
		const fail = (reason: string) =>
			unrecognized.push({ line: row.line, text: excerpt(row.cells.join(" ")), reason });

		const date = parseStatementDate(cell(mapping.date));
		const description = cleanText(
			mapping.description
				.map((i) => cell(i))
				.filter((v, i, all) => v !== "" && all.indexOf(v) === i)
				.join(" - "),
		);
		if (isBalanceLabel(description)) {
			balances++;
			continue;
		}
		if (date === null) {
			fail("data inválida");
			continue;
		}
		let amount: number | null;
		if (mapping.amount !== undefined) {
			amount = parseAmount(cell(mapping.amount));
			if (amount !== null) amount *= cardSign;
		} else {
			// Saída e entrada em colunas separadas: o sinal vem da coluna, não do número.
			const out = cell(mapping.debit);
			const into = cell(mapping.credit);
			const o = out === "" ? null : parseAmount(out);
			const i = into === "" ? null : parseAmount(into);
			if (
				(out !== "" && o === null) ||
				(into !== "" && i === null) ||
				(o !== null && i !== null && o !== 0 && i !== 0)
			) {
				amount = null;
			} else if (o !== null && o !== 0) amount = -Math.abs(o);
			else if (i !== null && i !== 0) amount = Math.abs(i);
			else amount = null;
		}
		if (amount === null || amount === 0) {
			fail("valor inválido");
			continue;
		}
		if (description === "") {
			fail("sem descrição");
			continue;
		}
		const bankId = mapping.externalId === undefined ? null : cell(mapping.externalId) || null;
		drafts.push({ date, amountCents: amount * flip, description, bankId });
	}

	const { items, repeatedIds } = withBankIds(drafts);
	if (balances > 0) warnings.push(`${balances} linhas de saldo foram ignoradas (não são lançamentos).`);
	if (repeatedIds > 0) {
		warnings.push(
			`${repeatedIds} linhas repetiam o identificador do banco; usei data, valor e descrição no lugar.`,
		);
	}
	return { status: "ok", format: "csv", items, unrecognized, warnings, accountHint: null };
}

export function parseCsv(bytes: Uint8Array, options: ParseOptions = {}): ParsedStatement | NeedsMapping {
	const text = decodeBytes(bytes);
	const delimiter = options.mapping?.delimiter ?? detectDelimiter(text);
	const rows = splitRows(text, delimiter);
	if (rows.length === 0 || Math.max(...rows.map((r) => r.cells.length)) < 2) {
		throw new StatementError("unreadable", "Não consegui ler colunas neste arquivo CSV.");
	}

	if (options.mapping) {
		const m = options.mapping;
		return convertRows(rows, { ...m, delimiter }, options);
	}

	const header = findHeader(rows);
	if (header && complete(header.suggestion)) {
		const s = header.suggestion;
		const mapping: CsvMapping = {
			delimiter,
			headerRow: header.index,
			date: s.date as number,
			description: s.description,
			...(s.amount === undefined ? {} : { amount: s.amount }),
			...(s.amount === undefined && s.debit !== undefined ? { debit: s.debit } : {}),
			...(s.amount === undefined && s.credit !== undefined ? { credit: s.credit } : {}),
			...(s.externalId === undefined ? {} : { externalId: s.externalId }),
		};
		return convertRows(rows, mapping, options);
	}
	if (header) {
		return needsMapping(
			rows,
			delimiter,
			header.index,
			header.suggestion,
			header.suggestion.ambiguous ?? "Não reconheci as colunas.",
			true,
		);
	}
	// Sem cabeçalho reconhecível: sugere pelo conteúdo e deixa o dono confirmar.
	// `headerRow` passa a ser a linha antes da primeira de dados (o que vem antes é texto do banco, não lançamento).
	const firstDataAt = rows.findIndex((r) => r.cells.some((c) => parseStatementDate(c) !== null));
	const guess =
		firstDataAt >= 0
			? suggestFromContent((rows[firstDataAt] as Row).cells)
			: { description: [], ambiguous: null };
	return needsMapping(
		rows,
		delimiter,
		firstDataAt > 0 ? firstDataAt - 1 : null,
		guess,
		"Não encontrei o cabeçalho com data, descrição e valor. Diga qual coluna é qual.",
		false,
	);
}
