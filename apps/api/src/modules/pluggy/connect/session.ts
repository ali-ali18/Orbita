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
	now: Date,
): Promise<CreatedConnectSession> {
	const token = randomBytes(32).toString("base64url");
	const expiresAt = new Date(now.getTime() + CONNECT_SESSION_TTL_MS);
	await store.create({ tokenHash: hashConnectToken(token), expiresAt, now });
	await store.deleteStale(new Date(now.getTime() - STALE_AFTER_MS));
	return { token, expiresAt };
}

/** O que o app abre no navegador. O token vai no fragmento (`#s=`): o navegador não o envia ao servidor. */
export const connectPagePath = (token: string) => `/pluggy/conectar#s=${token}`;
