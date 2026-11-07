/*
 * Limpeza do nome que o Pluggy manda. No conector "MeuPluggy" o nome das contas chega com o prefixo do conector
 * ("MeuPluggy Mercado Pago…", "MeuPluggy BANCO INTER…") e, muitas vezes, em caixa alta e com sufixo legal
 * ("Banco Santander (Brasil) S.A."). Cada item do MeuPluggy é um banco só.
 */

const PREFIX = /^meu\s*pluggy\b[\s:\-–—]*/i;

/** O nome começa com o prefixo "MeuPluggy" (com ou sem espaço, qualquer caixa)? */
export const hasMeuPluggyPrefix = (value: string): boolean => PREFIX.test(value.trim());

const squash = (v: string) =>
	v
		.replace(/\p{Cc}/gu, " ")
		.replace(/\s+/g, " ")
		.trim();

/** Minúsculo, sem acento nem pontuação, sem "(…)" e sem "S.A." no fim: base para reconhecer o banco. */
const key = (v: string) =>
	v
		.replace(/\([^)]*\)/g, " ")
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim()
		.replace(/\bs a$/, "")
		.trim();

// Só reconhece o banco quando o nome inteiro é o banco: "Mercado Pago Conta Corrente" continua com a conta.
const KNOWN_BANKS: ReadonlyArray<readonly [name: string, match: RegExp]> = [
	["Santander", /^(banco )?santander( brasil)?$/],
	["Inter", /^(banco )?inter$/],
	["Nubank", /^(nubank|nu bank|nu pagamentos)$/],
	["Mercado Pago", /^mercado pago$/],
	["Itaú", /^(banco )?itau( unibanco)?$/],
	["Bradesco", /^(banco )?bradesco$/],
	["Banco do Brasil", /^(banco do brasil|bb)$/],
	["Caixa", /^(caixa|caixa economica federal)$/],
	["C6", /^(banco )?c6( bank)?$/],
	["BTG", /^(banco )?btg( pactual)?$/],
	["PicPay", /^(picpay|pic pay)$/],
];

const SMALL_WORDS = new Set(["de", "do", "da", "dos", "das", "e"]);

function titleCase(text: string): string {
	return text
		.toLowerCase()
		.split(" ")
		.map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
		.join(" ");
}

/**
 * Nome limpo de banco/conta: sem o prefixo "MeuPluggy"; bancos comuns viram o nome curto ("Banco Santander
 * (Brasil) S.A." → "Santander"); o resto fica como veio, só em Title Case quando veio todo em caixa alta (ou baixa).
 */
export function cleanBankName(raw: string): string {
	const text = squash(raw.trim().replace(PREFIX, ""));
	if (text.length === 0) return "";
	const k = key(text);
	for (const [name, match] of KNOWN_BANKS) if (match.test(k)) return name;
	return text === text.toUpperCase() || text === text.toLowerCase() ? titleCase(text) : text;
}

/** O conector é o "MeuPluggy" (que não é banco)? */
export const isMeuPluggyConnector = (name: string | null | undefined): boolean =>
	name != null && /^meu\s*pluggy$/i.test(name.trim());
