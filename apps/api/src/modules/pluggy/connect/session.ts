import { createHash, randomBytes } from "node:crypto";
import type { PluggyConnectSessionStore } from "@orbita/db";

/** Vida da sessão: tempo de achar o banco, entrar e confirmar no app do banco. */
export const CONNECT_SESSION_TTL_MS = 15 * 60_000;
/** Sessões usadas ou vencidas há mais que isto são apagadas (limpeza oportunista a cada sessão nova). */
const STALE_AFTER_MS = 24 * 60 * 60_000;

/** Token de 256 bits em base64url (43 letras). Alta entropia: SHA-256 puro basta, como no token do aparelho. */
export const hashConnectToken = (token: string): string => createHash("sha256").update(token).digest("hex");

export interface CreatedConnectSession {
	/** Só existe aqui e na resposta ao app; no banco fica o hash. */
	token: string;
	expiresAt: Date;
}

export async function createConnectSession(
	store: PluggyConnectSessionStore,
	deviceId: string,
	now: Date,
	/** Reconexão: o item já cadastrado que o widget vai atualizar. Sem isto, é conexão nova. */
	updateItemId?: string,
): Promise<CreatedConnectSession> {
	const token = randomBytes(32).toString("base64url");
	const expiresAt = new Date(now.getTime() + CONNECT_SESSION_TTL_MS);
	await store.create({
		tokenHash: hashConnectToken(token),
		deviceId,
		expiresAt,
		now,
		...(updateItemId ? { updateItemId } : {}),
	});
	await store.deleteStale(new Date(now.getTime() - STALE_AFTER_MS));
	return { token, expiresAt };
}

/** O que o app abre no navegador. O token vai no fragmento (`#s=`): o navegador não o envia ao servidor. */
export const connectPagePath = (token: string) => `/pluggy/conectar#s=${token}`;

/** Tolerância de relógio entre o servidor e o Pluggy: o item só vale se nasceu depois de (sessão − 2 min). */
export const ITEM_CLOCK_SKEW_MS = 2 * 60_000;

/** O item foi criado depois que a sessão começou? Item velho (ou já removido) não volta por uma sessão nova. */
export function itemIsFresh(itemCreatedAt: string | null | undefined, sessionCreatedAt: Date): boolean {
	const created = itemCreatedAt ? Date.parse(itemCreatedAt) : Number.NaN;
	return Number.isFinite(created) && created >= sessionCreatedAt.getTime() - ITEM_CLOCK_SKEW_MS;
}
