import { parseAmount } from "./amount.ts";
import { parseStatementDate } from "./date.ts";
import { withBankIds } from "./ids.ts";
import { cleanText, decodeBytes, excerpt } from "./text.ts";
import type { ParsedStatement, ParseOptions, UnrecognizedLine } from "./types.ts";

/*
 * OFX 1.x (SGML: folhas sem tag de fechamento) e 2.x (XML). Os dois se leem do mesmo jeito: uma sequência de
 * tags `<NOME>valor`, em que só os agregados (`STMTTRN`…) têm fechamento. Nada aqui executa nem interpreta
 * entidades externas: é só texto.
 */

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeEntities(value: string): string {
	return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
		if (name.startsWith("#")) {
			const code =
				name[1]?.toLowerCase() === "x" ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
			return Number.isInteger(code) && code > 31 && code < 0x10ffff ? String.fromCodePoint(code) : " ";
		}
		return ENTITIES[name.toLowerCase()] ?? whole;
	});
}

interface RawTransaction {
	fields: Map<string, string>;
	account: string | null;
	index: number;
}

/** O arquivo parece OFX? (cabeçalho OFXHEADER ou tag `<OFX>` nos primeiros bytes). */
export function looksLikeOfx(text: string): boolean {
	const head = text.slice(0, 4096);
	return /OFXHEADER\s*:/i.test(head) || /<OFX[\s>]/i.test(head);
}

const TAG = /<(\/?)([A-Za-z][A-Za-z0-9.]*)\s*>([^<]*)/g;

function collect(text: string): { transactions: RawTransaction[]; accounts: string[] } {
	const start = text.search(/<OFX[\s>]/i);
	const body = start >= 0 ? text.slice(start) : text;
	const transactions: RawTransaction[] = [];
	const accounts: string[] = [];
	let account: string | null = null;
	let current: RawTransaction | null = null;
	let count = 0;
	for (const match of body.matchAll(TAG)) {
		const closing = match[1] === "/";
		const name = (match[2] as string).toUpperCase();
		const value = decodeEntities((match[3] ?? "").trim());
		if (name === "STMTTRN") {
			if (current) transactions.push(current);
			current = closing ? null : { fields: new Map(), account, index: ++count };
			continue;
		}
		if (closing) {
			if (name === "BANKTRANLIST" || name === "STMTRS" || name === "CCSTMTRS") {
				if (current) transactions.push(current);
				current = null;
			}
			continue;
		}
		if (name === "ACCTID" && value !== "") {
			if (current === null) {
				account = value;
				if (!accounts.includes(value)) accounts.push(value);
			}
			continue;
		}
		if (current && value !== "" && !current.fields.has(name)) current.fields.set(name, value);
	}
	if (current) transactions.push(current);
	return { transactions, accounts };
}

function describe(fields: Map<string, string>): string {
	const name = fields.get("NAME") ?? "";
	const memo = fields.get("MEMO") ?? "";
	if (name && memo && name !== memo) {
		if (memo.toLowerCase().startsWith(name.toLowerCase())) return memo;
		if (name.toLowerCase().startsWith(memo.toLowerCase())) return name;
		return `${name} - ${memo}`;
	}
	return name || memo || fields.get("PAYEE") || "";
}

export function parseOfx(bytes: Uint8Array, options: ParseOptions = {}): ParsedStatement {
	const text = decodeBytes(bytes);
	const { transactions, accounts } = collect(text);
	const warnings: string[] = [];
	const unrecognized: UnrecognizedLine[] = [];
	const drafts: Array<{ date: string; amountCents: number; description: string; bankId: string | null }> = [];
	const flip = options.invertSign === true ? -1 : 1;

	for (const tx of transactions) {
		const raw = [tx.fields.get("DTPOSTED"), tx.fields.get("TRNAMT"), describe(tx.fields)].join(" | ");
		const date = parseStatementDate(tx.fields.get("DTPOSTED") ?? tx.fields.get("DTUSER") ?? "");
		const amount = parseAmount(tx.fields.get("TRNAMT") ?? "");
		const description = cleanText(describe(tx.fields));
		if (date === null || amount === null || amount === 0 || description === "") {
			const reason =
				date === null
					? "data inválida"
					: amount === null || amount === 0
						? "valor inválido"
						: "sem descrição";
			unrecognized.push({ line: tx.index, text: excerpt(raw), reason });
			continue;
		}
		const fitid = tx.fields.get("FITID");
		// Mais de uma conta no arquivo: o mesmo FITID pode repetir entre elas; o id inclui a conta.
		const bankId = fitid ? (accounts.length > 1 && tx.account ? `${tx.account}:${fitid}` : fitid) : null;
		drafts.push({ date, amountCents: amount * flip, description, bankId });
	}

	const { items, repeatedIds } = withBankIds(drafts);
	if (transactions.length === 0) warnings.push("Não encontrei nenhum lançamento neste arquivo OFX.");
	if (accounts.length > 1)
		warnings.push("O arquivo tem mais de uma conta; todos os lançamentos vão para a conta escolhida.");
	if (repeatedIds > 0) {
		warnings.push(
			`${repeatedIds} lançamentos repetiam o identificador do banco; usei data, valor e descrição no lugar.`,
		);
	}
	return { status: "ok", format: "ofx", items, unrecognized, warnings, accountHint: accounts[0] ?? null };
}
