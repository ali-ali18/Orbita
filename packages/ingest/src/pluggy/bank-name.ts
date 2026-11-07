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
		.replace(/\p{Cf}/gu, "")
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

/** Sigla: até 4 letras, todas maiúsculas ("BMG", "S.A."). */
const isAcronym = (w: string) => {
	const letters = w.replace(/[^\p{L}]/gu, "");
	return (
		letters.length > 0 &&
		letters.length <= 4 &&
		letters === letters.toUpperCase() &&
		letters !== letters.toLowerCase()
	);
};

function titleCase(text: string): string {
	return text
		.split(" ")
		.map((word, i) => {
			const w = word.toLowerCase();
			if (i > 0 && SMALL_WORDS.has(w)) return w;
			if (isAcronym(word)) return word;
			return w.charAt(0).toUpperCase() + w.slice(1);
		})
		.join(" ");
}

/**
 * Nome limpo de banco/conta: sem o prefixo "MeuPluggy"; bancos comuns viram o nome curto ("Banco Santander
 * (Brasil) S.A." → "Santander"); o resto fica como veio, só em Title Case quando veio todo em caixa alta (ou baixa).
 */
export function cleanBankName(raw: string): string {
	// Invisíveis (ZWSP, bidi) saem antes de aparar e de decidir se ficou vazio; prefixo repetido sai todo.
	let text = squash(raw);
	while (PREFIX.test(text)) text = squash(text.replace(PREFIX, ""));
	if (text.length === 0) return "";
	const k = key(text);
	for (const [name, match] of KNOWN_BANKS) if (match.test(k)) return name;
	return text === text.toUpperCase() || text === text.toLowerCase() ? titleCase(text) : text;
}

/** O conector é o "MeuPluggy" (que não é banco)? */
export const isMeuPluggyConnector = (name: string | null | undefined): boolean =>
	name != null && /^meu\s*pluggy$/i.test(name.trim());

// Bancos reconhecidos DENTRO de um nome maior ("Conta Corrente Inter", "Nubank Mastercard Gold").
const BANK_WORDS: ReadonlyArray<readonly [name: string, match: RegExp]> = [
	["Santander", /\bsantander\b/],
	["Nubank", /\b(nubank|nu bank)\b/],
	["Inter", /\b(banco inter|inter)\b/],
	["Mercado Pago", /\bmercado pago\b/],
	["Itaú", /\bitau\b/],
	["Bradesco", /\bbradesco\b/],
	["Banco do Brasil", /\bbanco do brasil\b/],
	["Caixa", /\bcaixa( economica)?\b/],
	["C6", /\bc6\b/],
	["BTG", /\bbtg\b/],
	["PicPay", /\b(picpay|pic pay)\b/],
];

/** Banco conhecido citado em qualquer parte do nome ("Conta Corrente Inter" → "Inter"); `null` se nenhum. */
export function findKnownBank(raw: string | null | undefined): string | null {
	const k = key(squash(raw ?? ""));
	if (k === "") return null;
	for (const [name, match] of BANK_WORDS) if (match.test(k)) return name;
	return null;
}

// Palavras de bandeira/nível que não dizem de qual banco é o cartão.
const GENERIC_CARD_WORDS = new Set([
	"cartao",
	"credito",
	"de",
	"do",
	"card",
	"credit",
	"mastercard",
	"master",
	"visa",
	"elo",
	"amex",
	"american",
	"express",
	"hipercard",
	"diners",
	"club",
	"gold",
	"platinum",
	"black",
	"infinite",
	"grafite",
	"standard",
	"classic",
	"internacional",
	"nacional",
	"gold",
	"business",
	"empresarial",
	"signature",
]);

/**
 * Nome de cartão que não diz de qual banco é: vazio, uma ou duas letras ("G"), ou só bandeira/nível ("Mastercard
 * Gold"). Esses nomes ganham o nome do banco.
 */
export function isWeakCardName(name: string | null | undefined): boolean {
	const k = key(squash(name ?? ""));
	if (k.length <= 2) return true;
	return k.split(" ").every((w) => w.length <= 1 || GENERIC_CARD_WORDS.has(w));
}

/**
 * Banco da conexão. No MeuPluggy o conector não é banco: a pista é o nome das contas ("Conta Corrente Inter",
 * "Nubank Mastercard Gold"). Em último caso, o primeiro nome do rótulo da conexão. `null` se nada serve.
 */
export function detectBankName(input: {
	connectorName?: string | null | undefined;
	accountNames: readonly (string | null | undefined)[];
	connectionLabel?: string | null | undefined;
}): string | null {
	if (input.connectorName && !isMeuPluggyConnector(input.connectorName)) {
		const named = cleanBankName(input.connectorName);
		if (named) return named;
	}
	for (const name of input.accountNames) {
		const bank = findKnownBank(name);
		if (bank) return bank;
	}
	const label = cleanBankName(
		(input.connectionLabel ?? "")
			.split(",")[0]
			?.replace(/\s\+\d+$/, "")
			.trim() ?? "",
	);
	if (
		label &&
		!isWeakCardName(label) &&
		!isMeuPluggyConnector(label) &&
		!/\b(conta|corrente|poupanca|cartao|credito)\b/.test(key(label))
	)
		return label;
	return null;
}

/** Nome do cartão: o banco quando o nome do cartão é fraco; "Banco Nome" quando o nome não cita o banco. */
export function cardDisplayName(own: string, bank: string | null): string {
	if (bank === null) return own;
	if (isWeakCardName(own)) return bank;
	return key(own).includes(key(bank)) ? own : `${bank} ${own}`;
}
