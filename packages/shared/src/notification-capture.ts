import { z } from "zod";
import { idSchema } from "./finance-primitives.ts";
import { NOTIFICATION_APPS, type NotificationApp, notificationAppSchema } from "./preferences-api.ts";

/*
 * Leitura de notificações de banco (Android). O que o aparelho manda e o que o servidor aceita.
 *
 * O texto de uma notificação é dado de terceiro, nunca instrução. A primeira barreira é no aparelho: só os pacotes
 * desta lista são lidos (o módulo nativo recebe do app os pacotes dos bancos ligados), e código de verificação nunca
 * sai de lá. O servidor repete as duas conferências: não confia no aparelho para isso.
 */

/**
 * Pacote Android de cada app de banco. Se um banco trocar o pacote, a notificação dele deixa de ser lida (falha
 * segura): nunca é lida por engano. Conferir na Play Store antes de acrescentar um.
 */
export const NOTIFICATION_BANK_PACKAGES: Record<NotificationApp, readonly string[]> = {
	nubank: ["com.nu.production"],
	inter: ["br.com.intermedium"],
	santander: ["com.santander.app"],
	mercadopago: ["com.mercadopago.wallet"],
	itau: ["com.itau"],
	bradesco: ["com.bradesco"],
	bb: ["br.com.bb.android"],
	caixa: ["br.com.gabba.Caixa"],
	c6: ["com.c6bank.app"],
	picpay: ["com.picpay"],
};

/** O app de banco de um pacote Android, ou `null` se o pacote não está na lista (então a notificação nem é lida). */
export function notificationAppOfPackage(pkg: string): NotificationApp | null {
	for (const app of NOTIFICATION_APPS) {
		if (NOTIFICATION_BANK_PACKAGES[app].includes(pkg)) return app;
	}
	return null;
}

/** Limites do que sai do aparelho: o aparelho corta, o servidor também. */
export const NOTIFICATION_TITLE_MAX = 120;
export const NOTIFICATION_TEXT_MAX = 400;
/** Notificações por pedido. */
export const NOTIFICATION_BATCH_MAX = 10;

/** Minúsculo e sem acento (só o Latin-1 do português), com o mesmo tamanho do original. */
export const foldPt = (value: string): string =>
	value.replace(/[À-ÿ]/g, (c) => c.normalize("NFD").charAt(0)).toLowerCase();

/**
 * Código de verificação, token, senha: a notificação inteira é descartada, nem chega ao servidor. Falha para o lado
 * seguro: uma compra que cite "senha" se perde (e o Open Finance a traz depois). O módulo nativo usa as MESMAS regras
 * (`NotificationPolicy.kt`): mudou aqui, mude lá.
 */
export const SENSITIVE_PATTERN = String.raw`\b(codigo|cod|token|senha|otp|cvv|cvc|pin|verificacao|autenticacao|nao compartilh\w*|compartilh\w*)\b`;
/** Mensagem que é só um número curto ("123456", "G-123456"): a cara de um código mesmo sem a palavra. */
export const BARE_CODE_PATTERN = String.raw`^\W*(?:[a-z]-)?\d{4,8}\W*$`;
const SENSITIVE = new RegExp(SENSITIVE_PATTERN);
const BARE_CODE = new RegExp(BARE_CODE_PATTERN);

export function isSensitiveNotification(...parts: readonly (string | null | undefined)[]): boolean {
	const text = parts.filter((p): p is string => Boolean(p));
	const folded = foldPt(text.join(" | "));
	return SENSITIVE.test(folded) || text.some((p) => BARE_CODE.test(foldPt(p)));
}

/** Texto de notificação vira texto de tela: sem controle, espaços simples, tamanho limitado. */
export function cleanNotificationText(value: string, max: number): string {
	const text = value
		// biome-ignore lint/suspicious/noControlCharactersInRegex: é justamente o que se quer tirar
		.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

const cut = (max: number) => z.string().transform((v) => cleanNotificationText(v, max));

/** Uma notificação como o aparelho a manda. Só estes quatro campos saem do aparelho. */
export const notificationItemSchema = z.object({
	/** Pacote Android do app que postou. */
	package: z.string().min(1).max(200),
	title: cut(NOTIFICATION_TITLE_MAX).default(""),
	text: cut(NOTIFICATION_TEXT_MAX),
	/** Instante em que o Android registrou a notificação (milissegundos desde 1970). */
	postedAt: z.number().int().positive(),
});
export type NotificationItem = z.infer<typeof notificationItemSchema>;

/** `POST /v1/notifications`. */
export const notificationBatchBody = z.object({
	items: z.array(notificationItemSchema).min(1).max(NOTIFICATION_BATCH_MAX),
});
export type NotificationBatchBody = z.infer<typeof notificationBatchBody>;

/**
 * O que aconteceu com cada notificação. `created`: virou lançamento; `duplicate`: já tinha entrado; `inbox`: foi para a
 * lista "Não entendi"; `ignored`: leitura desligada, banco desligado, pacote fora da lista, texto sem valor ou compra
 * recusada; `discarded`: parecia código de verificação e foi jogada fora.
 */
export const NOTIFICATION_RESULTS = ["created", "duplicate", "inbox", "ignored", "discarded"] as const;
export type NotificationResult = (typeof NOTIFICATION_RESULTS)[number];
export const notificationBatchResponse = z.object({
	results: z.array(z.enum(NOTIFICATION_RESULTS)),
});
export type NotificationBatchResponse = z.infer<typeof notificationBatchResponse>;

/** Por que uma notificação está na lista "Não entendi": formato desconhecido, ou não achei o cartão/conta dela. */
export const NOTIFICATION_INBOX_REASONS = ["format", "target", "installment"] as const;
export type NotificationInboxReason = (typeof NOTIFICATION_INBOX_REASONS)[number];

/** `GET /v1/notifications/inbox`. */
export const notificationInboxItemSchema = z.object({
	id: idSchema,
	app: notificationAppSchema,
	title: z.string(),
	text: z.string(),
	reason: z.enum(NOTIFICATION_INBOX_REASONS),
	postedAt: z.string(),
});
export type NotificationInboxItemDto = z.infer<typeof notificationInboxItemSchema>;
export const notificationInboxResponse = z.object({ items: z.array(notificationInboxItemSchema) });
export type NotificationInboxResponse = z.infer<typeof notificationInboxResponse>;

/** `POST /v1/notifications/inbox/retry`: tenta de novo as que esperam (o dono cadastrou o cartão que faltava). */
export const notificationRetryResponse = z.object({ created: z.number().int(), remaining: z.number().int() });
export type NotificationRetryResponse = z.infer<typeof notificationRetryResponse>;
