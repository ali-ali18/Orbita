import {
	ATTACHMENT_MARKER,
	ATTACHMENT_MAX_BYTES,
	ATTACHMENT_SIZE_MESSAGE,
	ATTACHMENT_TYPE_MESSAGE,
	type ChatAttachment,
	chatAttachmentSchema,
} from "@orbita/shared";

/*
 * Anexos do chat no app, em funções puras (o seletor, a câmera e a leitura do arquivo ficam em `attach-native.ts`).
 * As regras são as mesmas do servidor (`chatAttachmentSchema`): o app confere antes de enviar para o dono ver o
 * erro na hora, mas quem manda é o servidor.
 */

/** Maior lado da foto depois de reduzida (um comprovante continua legível e o arquivo fica pequeno). */
export const IMAGE_MAX_SIDE = 1600;
export const IMAGE_QUALITY = 0.8;

/** O que o dono escolheu no menu "+". */
export type AttachKind = "camera" | "library" | "pdf";

/** Um anexo pronto para enviar, com o que o chip mostra. */
export interface PendingAttachment extends ChatAttachment {
	name: string;
}

export type PickOutcome =
	| { status: "ok"; attachment: PendingAttachment }
	| { status: "cancelled" }
	| { status: "error"; message: string };

export const PERMISSION_CAMERA_MESSAGE =
	"Permita o uso da câmera nas configurações do aparelho para tirar a foto.";
export const READ_FAILED_MESSAGE = "Não consegui ler esse arquivo. Tente outro.";

/** PDF pelo tipo informado ou, se o aparelho não informar, pela extensão. */
export function isPdf(file: {
	mimeType?: string | null | undefined;
	name?: string | null | undefined;
}): boolean {
	if (file.mimeType) return file.mimeType.toLowerCase() === "application/pdf";
	return (file.name ?? "").toLowerCase().endsWith(".pdf");
}

/** Confere o PDF escolhido ANTES de ler o arquivo (tipo e tamanho). `null` = pode seguir. */
export function checkPickedPdf(file: {
	mimeType?: string | null | undefined;
	name?: string | null | undefined;
	size?: number | null | undefined;
}): string | null {
	if (!isPdf(file)) return ATTACHMENT_TYPE_MESSAGE;
	if (typeof file.size === "number" && file.size > ATTACHMENT_MAX_BYTES) return ATTACHMENT_SIZE_MESSAGE;
	return null;
}

/** Confere o anexo já em base64 com as regras do servidor. Mensagem em pt-BR, ou `null` se está certo. */
export function checkAttachment(attachment: ChatAttachment): string | null {
	const parsed = chatAttachmentSchema.safeParse(attachment);
	return parsed.success ? null : (parsed.error.issues[0]?.message ?? "Anexo inválido.");
}

/** Nome curto para o chip: cabe numa linha, com a extensão. */
export function shortName(name: string, max = 24): string {
	const clean = name.trim() || "arquivo";
	if (clean.length <= max) return clean;
	const dot = clean.lastIndexOf(".");
	const ext = dot > 0 && clean.length - dot <= 5 ? clean.slice(dot) : "";
	return `${clean.slice(0, max - ext.length - 1).trimEnd()}…${ext}`;
}

/** Bytes → base64 (o Hermes tem `btoa`; em pedaços para não estourar a pilha com 5 MB). */
export function bytesToBase64(bytes: Uint8Array): string {
	const STEP = 0x8000;
	let binary = "";
	for (let i = 0; i < bytes.length; i += STEP) {
		binary += String.fromCharCode(...bytes.subarray(i, i + STEP));
	}
	return btoa(binary);
}

/** O que aparece como fala do dono: o texto (se houver) e o marcador do anexo, o mesmo que o servidor guarda. */
export function userBubbleText(text: string, attachmentCount: number): string {
	const typed = text.trim();
	if (attachmentCount === 0) return typed;
	return [typed, ATTACHMENT_MARKER].filter(Boolean).join("\n");
}

/** Pode enviar: há texto ou anexo, e nada está em andamento. */
export function canSend(text: string, hasAttachment: boolean, busy: boolean): boolean {
	return !busy && (text.trim().length > 0 || hasAttachment);
}
