import { addDays, type LocalDate } from "@orbita/core";
import { getDocumentProxy } from "unpdf";
import { parseAmount } from "./amount.ts";
import { buildDate } from "./date.ts";
import { assignHashIds } from "./ids.ts";
import { cleanText, excerpt, isBalanceLabel } from "./text.ts";
import { type ParsedStatement, type ParseOptions, StatementError, type UnrecognizedLine } from "./types.ts";

/*
 * PDF de extrato ou fatura. O texto sai do PDF com o `unpdf` (pdf.js sem worker, só JS; licença MIT) e vira
 * linhas pela posição vertical. Cada linha só vira lançamento se tiver o formato inteiro, de forma conservadora:
 *
 *   <data> [<outra data>] <descrição> <valor> [<saldo>]
 *
 * Linha que parece lançamento (começa com data ou termina com valor) mas não fecha vai para `unrecognized`;
 * texto solto (cabeçalho, endereço, rodapé) é só contado. Nada é adivinhado: sem ano no documento, sem sinal
 * de entrada/saída ou com dois valores sem coluna de saldo, a linha é devolvida ao dono.
 */

export const DEFAULT_PDF_PAGE_LIMIT = 60;
const EXTRACT_TIMEOUT_MS = 20_000;

// ------------------------------------------------------------- extração

interface TextItem {
	str: string;
	transform: number[];
}

/** Linhas de texto do PDF, de cima para baixo, página a página. Lança `StatementError` se não der para ler. */
export async function extractPdfLines(
	bytes: Uint8Array,
	pageLimit = DEFAULT_PDF_PAGE_LIMIT,
): Promise<string[]> {
	const work = (async () => {
		let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
		try {
			// Cópia: o pdf.js assume a posse do buffer.
			pdf = await getDocumentProxy(new Uint8Array(bytes));
		} catch (error) {
			const name = error instanceof Error ? error.name : "";
			if (name === "PasswordException") {
				throw new StatementError(
					"encrypted",
					"Este PDF tem senha. Baixe o extrato sem senha e tente de novo.",
				);
			}
			throw new StatementError("unreadable", "Não consegui abrir este PDF.");
		}
		try {
			if (pdf.numPages > pageLimit) {
				throw new StatementError("too_large", `O PDF tem páginas demais (o limite é ${pageLimit}).`);
			}
			const lines: string[] = [];
			for (let p = 1; p <= pdf.numPages; p++) {
				const page = await pdf.getPage(p);
				const content = await page.getTextContent();
				lines.push(...groupLines(content.items as unknown as TextItem[]));
			}
			return lines;
		} finally {
			await Promise.resolve((pdf as { destroy?: () => Promise<void> }).destroy?.()).catch(() => undefined);
		}
	})();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() => reject(new StatementError("unreadable", "O PDF demorou demais para ser lido.")),
			EXTRACT_TIMEOUT_MS,
		);
	});
	try {
		return await Promise.race([work, timeout]);
	} catch (error) {
		if (error instanceof StatementError) throw error;
		throw new StatementError("unreadable", "Não consegui ler o texto deste PDF.");
	} finally {
		clearTimeout(timer);
	}
}

/** Junta os pedaços de texto que estão na mesma altura (tolerância de 2 pontos), da esquerda para a direita. */
function groupLines(items: readonly TextItem[]): string[] {
	const rows: Array<{ y: number; parts: Array<{ x: number; str: string }> }> = [];
	for (const item of items) {
		if (typeof item.str !== "string" || item.str.trim() === "") continue;
		const x = item.transform[4] ?? 0;
		const y = item.transform[5] ?? 0;
		const row = rows.find((r) => Math.abs(r.y - y) <= 2);
		if (row) row.parts.push({ x, str: item.str });
		else rows.push({ y, parts: [{ x, str: item.str }] });
	}
	return rows
		.sort((a, b) => b.y - a.y)
		.map((r) =>
			r.parts
				.sort((a, b) => a.x - b.x)
				.map((p) => p.str.trim())
				.join(" "),
		);
}

// --------------------------------------------------------------- análise

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

const DATE_NUMERIC = /^(\d{2})\/(\d{2})(?:\/(\d{4}|\d{2}))?(?=\s)/;
const DATE_NAMED =
	/^(\d{1,2})\s+(?:de\s+)?(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-z]*\.?(?:\s+(?:de\s+)?(\d{4}))?(?=\s)/i;
const AMOUNT_TOKEN = String.raw`(?:R\$\s?)?[-−+]?\s?\d{1,3}(?:\.\d{3})*,\d{2}(?:\s?-)?(?:\s?[CD])?`;
const TRAILING_AMOUNT = new RegExp(`(?:^|\\s)(${AMOUNT_TOKEN})\\s*$`);
const FULL_DATE = /\b(\d{2})\/(\d{2})\/(\d{4})\b/g;

interface Money {
	cents: number;
	/** Houve sinal explícito (-, +, C ou D)? */
	marked: boolean;
}

function readMoney(token: string): Money | null {
	const t = token.trim();
	const suffix = /\s?([CD])$/.exec(t)?.[1];
	const body = suffix ? t.slice(0, t.length - 1).trim() : t;
	const cents = parseAmount(body);
	if (cents === null || cents === 0) return null;
	const magnitude = Math.abs(cents);
	if (suffix === "C") return { cents: magnitude, marked: true };
	if (suffix === "D") return { cents: -magnitude, marked: true };
	return { cents, marked: /^[-−+(]/.test(body) || body.endsWith("-") };
}

/** Maior data completa (com ano) do documento: referência para linhas "15/03" sem ano. */
function referenceDate(lines: readonly string[]): LocalDate | null {
	let best: LocalDate | null = null;
	for (const line of lines) {
		for (const m of line.matchAll(FULL_DATE)) {
			const date = buildDate(Number(m[3]), Number(m[2]), Number(m[1]));
			if (date !== null && (best === null || date > best)) best = date;
		}
	}
	return best;
}

function resolveDate(
	day: number,
	month: number,
	year: number | null,
	reference: LocalDate | null,
): LocalDate | null {
	if (year !== null) return buildDate(year, month, day);
	if (reference === null) return null;
	const refYear = Number(reference.slice(0, 4));
	const same = buildDate(refYear, month, day);
	if (same === null) return null;
	// Compra de dezembro numa fatura que vence em janeiro: a data cai um ano antes da referência.
	return same > addDays(reference, 31) ? buildDate(refYear - 1, month, day) : same;
}

interface Candidate {
	line: number;
	date: LocalDate;
	cents: number;
	marked: boolean;
	description: string;
}

export function parsePdfLines(lines: readonly string[], options: ParseOptions = {}): ParsedStatement {
	const reference = referenceDate(lines);
	const unrecognized: UnrecognizedLine[] = [];
	const warnings: string[] = [];
	const candidates: Candidate[] = [];
	const card = options.sign === "card";
	const hasBalanceColumn = lines.some(
		(l) =>
			!DATE_NUMERIC.test(`${l} `) &&
			/\bsaldo\b/i.test(l) &&
			/(valor|lan[cç]amento|hist[oó]rico|descri|d[eé]bito|cr[eé]dito)/i.test(l),
	);
	let balances = 0;
	let loose = 0;
	let noYear = 0;
	let inferred = 0;

	for (const [i, raw] of lines.entries()) {
		const line = raw.replace(/\s+/g, " ").trim();
		const number = i + 1;
		const numeric = DATE_NUMERIC.exec(`${line} `);
		const named = numeric ? null : DATE_NAMED.exec(`${line} `);
		const starts = numeric ?? named;
		const tokens: string[] = [];
		let rest = starts ? line.slice(starts[0].length).trim() : line;
		for (let guard = 0; guard < 4; guard++) {
			const m = TRAILING_AMOUNT.exec(rest);
			if (!m) break;
			tokens.unshift((m[1] as string).trim());
			rest = rest.slice(0, m.index).trim();
		}
		const failed = (reason: string) => unrecognized.push({ line: number, text: excerpt(line), reason });

		if (!starts) {
			if (tokens.length > 0 && !isBalanceLabel(rest)) failed("valor sem data");
			else if (tokens.length > 0) balances++;
			else loose++;
			continue;
		}
		if (tokens.length === 0) {
			failed("sem valor");
			continue;
		}
		if (tokens.length > 2 || (tokens.length === 2 && !hasBalanceColumn)) {
			failed("mais de um valor na linha");
			continue;
		}

		let year: number | null = null;
		let day: number;
		let month: number;
		if (numeric) {
			day = Number(numeric[1]);
			month = Number(numeric[2]);
			const y = numeric[3];
			year = y === undefined ? null : y.length === 2 ? 2000 + Number(y) : Number(y);
		} else {
			day = Number((named as RegExpExecArray)[1]);
			month = MONTHS.indexOf(((named as RegExpExecArray)[2] as string).toLowerCase()) + 1;
			const y = (named as RegExpExecArray)[3];
			year = y === undefined ? null : Number(y);
		}
		const date = resolveDate(day, month, year, reference);
		if (date === null) {
			if (year === null && reference === null) noYear++;
			failed(year === null && reference === null ? "não achei o ano no documento" : "data inválida");
			continue;
		}
		if (year === null) inferred++;
		// Segunda data (compra x lançamento): a primeira vale.
		const description = cleanText(rest.replace(/^\d{2}\/\d{2}(?:\/\d{2,4})?\s+/, "").replace(/R\$/g, " "));
		if (isBalanceLabel(description)) {
			balances++;
			continue;
		}
		if (description === "") {
			failed("sem descrição");
			continue;
		}
		const money = readMoney(tokens[0] as string);
		if (money === null) {
			failed("valor inválido");
			continue;
		}
		candidates.push({ line: number, date, cents: money.cents, marked: money.marked, description });
	}

	const docMarked = candidates.some((c) => c.marked);
	const drafts: Array<{ date: LocalDate; amountCents: number; description: string }> = [];
	const flip = options.invertSign === true ? -1 : 1;
	for (const c of candidates) {
		let cents = c.cents;
		if (card) {
			// Fatura: sem sinal é compra (saída); com "-" é pagamento ou estorno (entrada).
			cents = -cents;
		} else if (!c.marked) {
			// Extrato: sem sinal só vale se o documento usa sinal em outras linhas (aí sem sinal = entrada).
			if (!docMarked) {
				unrecognized.push({
					line: c.line,
					text: excerpt(c.description),
					reason: "não dá para saber se é entrada ou saída",
				});
				continue;
			}
		}
		drafts.push({ date: c.date, amountCents: cents * flip, description: c.description });
	}

	if (balances > 0)
		warnings.push(`${balances} linhas de saldo ou total foram ignoradas (não são lançamentos).`);
	if (noYear > 0)
		warnings.push("Linhas sem ano e sem nenhuma data completa no documento não foram importadas.");
	if (inferred > 0) {
		warnings.push("O ano de algumas linhas foi deduzido de outras datas do documento. Confira as datas.");
	}
	if (lines.length > 0 && loose === lines.length) warnings.push("Não encontrei nenhum lançamento neste PDF.");
	return {
		status: "ok",
		format: "pdf",
		items: assignHashIds(drafts),
		unrecognized,
		warnings,
		accountHint: null,
	};
}

export async function parsePdf(bytes: Uint8Array, options: ParseOptions = {}): Promise<ParsedStatement> {
	const lines = await extractPdfLines(bytes, options.pdfPageLimit ?? DEFAULT_PDF_PAGE_LIMIT);
	if (lines.length === 0) {
		throw new StatementError("unreadable", "Este PDF não tem texto (pode ser uma imagem escaneada).");
	}
	return parsePdfLines(lines, options);
}
