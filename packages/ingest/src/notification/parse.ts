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
}

export type ParseResult =
	| { outcome: "parsed"; data: ParsedNotification }
	/** Reconhecida e sem efeito: compra recusada. */
	| { outcome: "skip"; reason: "declined" | "info" }
	/** Não entendi. `hasAmount`: cita um valor em R$ (então vale mostrar ao dono); sem valor é propaganda, some. */
	| { outcome: "unrecognized"; hasAmount: boolean };

const MONEY = String.raw`r\$\s*(?<amount>\d{1,3}(?:\.\d{3})+(?:,\d{2})?|\d+(?:,\d{2})?)(?!\d|[.,]\d)`;
/** Onde um nome (estabelecimento, pessoa) termina. */
const END = String.raw`(?=\s*(?:[,;|]|\.(?:\s|$)|\s+(?:para\s+o|no|na|com|usando|via|do|de)\s+cartao|\s+(?:no|com)\s+(?:debito|credito)|\s+final\s+\d|\s+\(|\s*$))`;
const WHO = "(?<who>.+?)";

interface Pattern {
	kind: NotificationKind;
	re: RegExp;
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
	// Compra. Nubank: "Compra de R$ 47,98 APROVADA em FARMACIAS X para o cartão com final 0695".
	{
		kind: "credit_purchase",
		re: re(`compra (?:no (?:debito|credito) )?de ${MONEY}(?: aprovada)? em ${WHO}${END}`),
	},
	// Inter: "Compra aprovada: R$ 51,50 em KABUM no cartão final 9697".
	{
		kind: "credit_purchase",
		re: re(String.raw`compra (?:no (?:debito|credito) )?aprovada:?\s*${MONEY}\s+(?:em|no|na)\s+${WHO}${END}`),
	},
	// Santander: "Compra aprovada no cartão final 3143, R$ 31,90, SPOTIFY".
	{
		kind: "credit_purchase",
		re: re(
			String.raw`compra (?:no (?:debito|credito) )?aprovada(?:(?!r\$).)*?${MONEY}\s*[,;:-]\s*${WHO}${END}`,
		),
	},
	// Mercado Pago: "Você pagou R$ 61,51 a VIVO" (sai do saldo ou do cartão do app: tratado como pagamento da conta).
	{ kind: "debit_purchase", re: re(String.raw`voce pagou ${MONEY}\s+(?:a|para|ao|na|no)\s+${WHO}${END}`) },
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

/** Nome do estabelecimento ou da pessoa: limpo e curto, sem pontuação sobrando nas pontas. */
function cleanName(raw: string | undefined): string | null {
	if (raw === undefined) return null;
	const text = cleanNotificationText(raw, 100)
		.replace(/^[\s.,;:!\-–—]+|[\s.,;:!\-–—]+$/g, "")
		.trim();
	return text === "" ? null : text;
}

function tryParse(original: string): ParseResult {
	const folded = foldPt(original);
	const sameLength = folded.length === original.length;
	const hasAmount = /r\$\s*\d/.test(folded);
	if (DECLINED.test(folded)) return { outcome: "skip", reason: "declined" };
	if (REVERSAL.test(folded)) return { outcome: "unrecognized", hasAmount };
	for (const { kind, re: pattern } of PATTERNS) {
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
		return {
			outcome: "parsed",
			data: {
				kind: resolved,
				amountCents,
				merchant: cleanName(who),
				last4: resolved === "pix_sent" ? null : last4,
			},
		};
	}
	if (INFO.test(folded)) return { outcome: "skip", reason: "info" };
	return { outcome: "unrecognized", hasAmount };
}

/**
 * Lê uma notificação de banco. Tenta o texto sozinho e depois "título: texto" (alguns bancos põem o tipo da operação
 * no título e só o resto no texto). `app` hoje não muda o resultado: as regras de cada banco cabem no mesmo conjunto
 * de formatos, e o parâmetro existe para quando um banco precisar de regra própria.
 */
export function parseNotification(input: { app: NotificationApp; title: string; text: string }): ParseResult {
	const candidates = [input.text, input.title ? `${input.title}: ${input.text}` : ""].filter((c) => c !== "");
	let last: ParseResult = { outcome: "unrecognized", hasAmount: false };
	for (const candidate of candidates) {
		const result = tryParse(candidate);
		if (result.outcome === "parsed" || result.outcome === "skip") return result;
		last = {
			outcome: "unrecognized",
			hasAmount: last.outcome === "unrecognized" && last.hasAmount ? true : result.hasAmount,
		};
	}
	return last;
}
