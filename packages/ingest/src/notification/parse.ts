import { cleanNotificationText, foldPt, type NotificationApp } from "@orbita/shared";
import { parseAmount } from "../statement/amount.ts";

/*
 * Parser das notificações de banco (Android). Função pura: texto entra, dado sai; nada de rede, relógio ou banco.
 *
 * O texto da notificação é dado de terceiro: aqui ele só é LIDO por expressões regulares. Nunca vira instrução, e nada
 * que não esteja escrito nele é inventado: valor vem do texto (centavos inteiros, sem `float`), e formato que não se
 * reconhece devolve `unrecognized`, nunca um palpite.
 *
 * Os formatos dos quatro primeiros bancos vêm de notificações reais; os demais bancos usam as mesmas regras genéricas
 * (frases comuns: "compra aprovada", "Pix enviado"…) e podem não pegar tudo: o que escapa cai na lista "Não entendi".
 */

export type NotificationKind =
	/** Compra no cartão de crédito: precisa achar o cartão (final e banco). */
	| "credit_purchase"
	/** Compra no débito ou pagamento direto da conta: sai da conta do banco. */
	| "debit_purchase"
	| "pix_sent"
	| "pix_received"
	/** Pagamento de fatura de cartão: sai da conta e entra no cartão. */
	| "invoice_payment";

export interface ParsedNotification {
	kind: NotificationKind;
	/** Centavos, inteiro e positivo; o sentido vem do `kind`. */
	amountCents: number;
	/** Estabelecimento ou pessoa, como o banco escreveu (sem controle, tamanho limitado). `null` se não disse. */
	merchant: string | null;
	/** Últimos 4 dígitos do cartão, se a notificação disse. */
	last4: string | null;
	/**
	 * O texto não diz onde o dinheiro saiu (o Mercado Pago escreve igual para saldo e para cartão): o lançamento nunca
	 * entra confirmado, o dono confere em Para revisar.
	 */
	uncertainTarget?: true;
}

export type ParseResult =
	| { outcome: "parsed"; data: ParsedNotification }
	/** Reconhecida e sem efeito: compra recusada. */
	| { outcome: "skip"; reason: "declined" | "info" }
	/** Não entendi. `hasAmount`: cita um valor em R$ (então vale mostrar ao dono); sem valor é propaganda, some. */
	| { outcome: "unrecognized"; hasAmount: boolean; reason: UnrecognizedReason };

/**
 * Por que não entendi: `format` (nenhum formato conhecido, ou o texto traz mais de um valor/tipo e não dá para saber
 * qual vale) ou `installment` (compra parcelada: o valor do texto nem sempre é o da parcela, o dono lança).
 */
export type UnrecognizedReason = "format" | "installment";

const MONEY = String.raw`r\$\s*(?<amount>\d{1,3}(?:\.\d{3})+(?:,\d{2})?|\d+(?:,\d{2})?)(?!\d|[.,]\d)`;
/** Onde um nome (estabelecimento, pessoa) termina. */
const END = String.raw`(?=\s*(?:[,;|]|\.(?:\s|$)|\s+(?:para\s+o|no|na|com|usando|via|do|de)\s+cartao|\s+(?:no|com)\s+(?:debito|credito)|\s+final\s+\d|\s+\(|\s*$))`;
const WHO = "(?<who>.+?)";

interface Pattern {
	kind: NotificationKind;
	re: RegExp;
	uncertainTarget?: true;
}

const re = (source: string) => new RegExp(source, "di");

/** Ordem importa: a primeira que casa vale. Pix e fatura antes de compra ("pagou a fatura" não é compra). */
const PATTERNS: readonly Pattern[] = [
	// Pix e transferências recebidos.
	{
		kind: "pix_received",
		re: re(String.raw`recebeu (?:um )?pix de ${MONEY}(?:\s+(?:de|do|da)\s+${WHO}${END})?`),
	},
	{ kind: "pix_received", re: re(String.raw`pix recebido:?\s*${MONEY}(?:\s+(?:de|do|da)\s+${WHO}${END})?`) },
	{
		kind: "pix_received",
		re: re(String.raw`recebeu uma transferencia de ${MONEY}(?:\s+(?:de|do|da)\s+${WHO}${END})?`),
	},
	{
		kind: "pix_received",
		re: re(String.raw`(?:^|:\s*)(?<who>[^:]+?)\s+te enviou\s+(?:um pix de\s+)?${MONEY}`),
	},
	// Pix e transferências enviados.
	{
		kind: "pix_sent",
		re: re(String.raw`pix enviado:?\s*${MONEY}(?:\s+(?:para|pro|pra|a|ao)\s+${WHO}${END})?`),
	},
	{
		kind: "pix_sent",
		re: re(
			String.raw`voce (?:enviou|fez) (?:um )?(?:pix|transferencia)(?: de)?\s*${MONEY}(?:\s+(?:para|pro|pra|a|ao)\s+${WHO}${END})?`,
		),
	},
	{ kind: "pix_sent", re: re(String.raw`voce enviou ${MONEY}\s+(?:para|pro|pra|a|ao)\s+${WHO}${END}`) },
	{
		kind: "pix_sent",
		re: re(String.raw`transferencia enviada:?\s*${MONEY}(?:\s+(?:para|a|ao)\s+${WHO}${END})?`),
	},
	// Pagamento de fatura (o dinheiro sai da conta e abate o cartão).
	{ kind: "invoice_payment", re: re(String.raw`pagamento d[ea] fatura(?:(?!r\$).)*?${MONEY}`) },
	{ kind: "invoice_payment", re: re(String.raw`voce pagou a fatura(?:(?!r\$).)*?${MONEY}`) },
	{ kind: "invoice_payment", re: re(String.raw`fatura(?:(?!r\$).)*?${MONEY}\s+(?:foi\s+)?paga`) },
	// Compra. Nubank: "Compra de R$ 23,45 APROVADA em LOJA EXEMPLO para o cartão com final 4821".
	{
		kind: "credit_purchase",
		re: re(`compra (?:no (?:debito|credito) )?de ${MONEY}(?: aprovada)? em ${WHO}${END}`),
	},
	// Inter: "Compra aprovada: R$ 18,70 em LOJA TESTE no cartão final 7390".
	{
		kind: "credit_purchase",
		re: re(String.raw`compra (?:no (?:debito|credito) )?aprovada:?\s*${MONEY}\s+(?:em|no|na)\s+${WHO}${END}`),
	},
	// Santander: "Compra aprovada no cartão final 5512, R$ 12,34, SERVICO EXEMPLO".
	{
		kind: "credit_purchase",
		re: re(
			String.raw`compra (?:no (?:debito|credito) )?aprovada(?:(?!r\$).)*?${MONEY}\s*[,;:-]\s*${WHO}${END}`,
		),
	},
	// Mercado Pago: "Você pagou R$ 42,10 a EMPRESA EXEMPLO" (sai do saldo ou do cartão do app: tratado como pagamento da conta).
	{
		kind: "debit_purchase",
		re: re(String.raw`voce pagou ${MONEY}\s+(?:a|para|ao|na|no)\s+${WHO}${END}`),
		uncertainTarget: true,
	},
	// Genéricas de compra: "compra … R$ X em LOJA", "compra … LOJA … R$ X".
	{
		kind: "credit_purchase",
		re: re(String.raw`compra(?:(?!r\$).){0,60}?${MONEY}\s+(?:em|no|na|de|para)\s+${WHO}${END}`),
	},
	{
		kind: "credit_purchase",
		re: re(String.raw`compra (?:aprovada|realizada|efetuada)?\s*(?:em|no|na)\s+${WHO}\s*[,:-]?\s*${MONEY}`),
	},
];

const DECLINED =
	/\b(recusad[ao]|negad[ao]|nao aprovad[ao]|nao foi aprovad[ao]|nao autorizad[ao]|nao realizad[ao])\b/;
/** Estorno, cancelamento e afins mudam um lançamento que já existe: o dono decide, o parser não adivinha. */
const REVERSAL = /\b(estorn\w*|reembols\w*|cancelad[ao]|cancelamento|contestac\w*|devolvid[ao]|devolucao)\b/;
/** Aviso que não é movimentação: fatura fechada, limite, oferta. Some sem ir para a lista. */
const INFO =
	/\b(fatura (?:fechou|fechada|disponivel|vence|vencera|ja esta)|limite|oferta|promocao|cashback|desconto|sorteio|convite|vence (?:hoje|amanha))\b/;
const DEBIT_WORD = /\bdebito\b/;
const CREDIT_WORD = /\bcredito\b/;
const LAST4 = /(?:final|finalizado em|terminad[oa] em|terminando em|\*{2,4}|\.{3})\s*(\d{4})\b/;

/**
 * Parcelamento: "parcelado", "em 3 vezes", "em 10x" (colado a "em"/"de" e seguido de fim, pontuação ou "para o cartão",
 * "sem juros"…), "3x de R$ 40" e "R$ 120,00 10x". "2X SPORTS" (nome de loja) e "Parcele em até 12x no app" (propaganda)
 * não contam. `1x`/à vista também não.
 */
const INSTALLMENT = new RegExp(
	String.raw`\b(?:parcelad[oa]s?|parcelamento|em (?:[2-9]|\d{2}) vezes|(?:[2-9]|\d{2}) parcelas?|parcela \d` +
		String.raw`|(?:em|de)\s+(?:[2-9]|\d{2})\s?x(?=\s*(?:$|[.,;:]|\s(?:para|no|na|com|sem|de|do|da|e|ou)\b))` +
		String.raw`|(?:[2-9]|\d{2})\s?x\s+de\s+r\$)` +
		String.raw`|r\$\s*[\d.,]+\s?(?:[2-9]|\d{2})\s?x\b`,
);
const ANY_MONEY = /r\$\s*(\d{1,3}(?:\.\d{3})+(?:,\d{2})?|\d+(?:,\d{2})?)(?!\d|[.,]\d)/g;
/** "Limite disponível: R$ 1.000,00", "Seu saldo é R$ 300,00": valores que acompanham a notificação, não a operação. */
const SIDE_BALANCE = /(?:limite|saldo|disponivel)(?:(?!r\$).){0,40}?r\$\s*[\d.,]+/g;

/** Os valores distintos em R$ de um texto (o mesmo valor repetido conta uma vez). */
function distinctAmounts(folded: string): Set<string> {
	const out = new Set<string>();
	for (const m of folded.replace(SIDE_BALANCE, " ").matchAll(ANY_MONEY))
		out.add(String(parseAmount(m[1] ?? "") ?? m[1]));
	return out;
}

/** Nome do estabelecimento ou da pessoa: limpo e curto, sem data/hora na frente nem "em 10x" atrás. */
function cleanName(raw: string | undefined): string | null {
	if (raw === undefined) return null;
	const text = cleanNotificationText(raw, 100)
		.replace(/^\d{1,2}\/\d{1,2}(?:\/\d{2,4})?(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?\s+/, "")
		.replace(/\s+em\s+\d{1,2}\s?x$/i, "")
		.replace(/^[\s.,;:!\-–—]+|[\s.,;:!\-–—]+$/g, "")
		.trim();
	return text === "" ? null : text;
}

const unrecognized = (hasAmount: boolean, reason: UnrecognizedReason = "format"): ParseResult => ({
	outcome: "unrecognized",
	hasAmount,
	reason,
});

function tryParse(original: string): ParseResult {
	const folded = foldPt(original);
	const sameLength = folded.length === original.length;
	const hasAmount = /r\$\s*\d/.test(folded);
	if (DECLINED.test(folded)) return { outcome: "skip", reason: "declined" };
	if (REVERSAL.test(folded)) return unrecognized(hasAmount);
	if (hasAmount && INSTALLMENT.test(folded)) return unrecognized(true, "installment");
	// Dois valores diferentes no mesmo texto (ou texto de terceiro com um valor falso dentro): não dá para saber qual vale.
	if (distinctAmounts(folded).size > 1) return unrecognized(true);
	const hits: { data: ParsedNotification }[] = [];
	for (const { kind, re: pattern, uncertainTarget } of PATTERNS) {
		const m = pattern.exec(folded);
		if (!m?.groups) continue;
		const amountCents = parseAmount(m.groups.amount ?? "");
		if (amountCents === null || amountCents <= 0) continue;
		const whoRange = m.indices?.groups?.who;
		const who = whoRange ? (sameLength ? original : folded).slice(whoRange[0], whoRange[1]) : undefined;
		const last4 = LAST4.exec(folded)?.[1] ?? null;
		let resolved: NotificationKind = kind;
		// Compra no débito não passa pelo cartão de crédito: sai da conta.
		if (kind === "credit_purchase" && DEBIT_WORD.test(folded) && !CREDIT_WORD.test(folded)) {
			resolved = "debit_purchase";
		}
		hits.push({
			data: {
				kind: resolved,
				amountCents,
				merchant: cleanName(who),
				last4: resolved === "pix_sent" ? null : last4,
				...(uncertainTarget ? { uncertainTarget } : {}),
			},
		});
	}
	const first = hits[0];
	if (first) {
		// Dois tipos de operação no mesmo texto ("Pix recebido ... Compra aprovada ..."): ambíguo.
		if (hits.some((h) => h.data.kind !== first.data.kind)) return unrecognized(true);
		return { outcome: "parsed", data: first.data };
	}
	if (INFO.test(folded)) return { outcome: "skip", reason: "info" };
	return unrecognized(hasAmount);
}

/**
 * Lê uma notificação de banco. Tenta o texto sozinho e depois "título: texto" (alguns bancos põem o tipo da operação
 * no título e só o resto no texto). Título e texto que discordam (outro valor, outro tipo) não se resolvem aqui: vão
 * para o dono, porque o texto de um app de banco pode trazer conteúdo de terceiros. `app` hoje não muda o resultado.
 */
export function parseNotification(input: { app: NotificationApp; title: string; text: string }): ParseResult {
	const { title, text } = input;
	const hasTitleAmount = /r\$\s*\d/.test(foldPt(title));
	if (title && distinctAmounts(foldPt(`${title} ${text}`)).size > 1) return unrecognized(true);
	if (hasTitleAmount) {
		const t = tryParse(title);
		const b = tryParse(text);
		if (
			t.outcome === "parsed" &&
			b.outcome === "parsed" &&
			(t.data.kind !== b.data.kind || t.data.amountCents !== b.data.amountCents)
		) {
			return unrecognized(true);
		}
	}
	// Título que repete o valor do corpo ("Compra aprovada R$ 30,00" + "R$ 30,00 em PADARIA"): sem o valor no título, o
	// texto junto lê como um formato só.
	const titleNoMoney = title
		.replace(/R\$\s*[\d.,]+/gi, "")
		.replace(/\s+/g, " ")
		.trim();
	const candidates = [
		text,
		hasTitleAmount && titleNoMoney ? `${titleNoMoney}: ${text}` : "",
		title ? `${title}: ${text}` : "",
	].filter((c) => c !== "");
	let last: ParseResult = unrecognized(false);
	for (const candidate of candidates) {
		const result = tryParse(candidate);
		if (result.outcome === "parsed" || result.outcome === "skip") return result;
		const hasAmount = last.outcome === "unrecognized" && last.hasAmount ? true : result.hasAmount;
		// Parcelamento vence formato desconhecido: é o motivo mais específico.
		last = unrecognized(
			hasAmount,
			result.reason === "installment" || (last.outcome === "unrecognized" && last.reason === "installment")
				? "installment"
				: "format",
		);
	}
	return last;
}
