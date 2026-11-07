export interface PluggyConnectSessionRecord {
	/** O aparelho que pediu a sessão (se for revogado, a sessão não vale mais). */
	deviceId: string;
	createdAt: Date;
}

/**
 * Sessões do "Conectar banco" (Pluggy Connect). O app pede uma ao servidor e entrega o token à página web do
 * widget; a página o devolve ao servidor para provar que veio do app. No banco fica só o hash do token.
 */
export interface PluggyConnectSessionStore {
	/**
	 * Cria a sessão e expira as anteriores ainda vivas: só uma fica ativa por vez, mesmo com pedidos simultâneos
	 * (lock no banco). Apaga as velhas.
	 */
	create(input: { tokenHash: string; deviceId: string; expiresAt: Date; now: Date }): Promise<void>;
	/** A sessão, se existe, não foi usada e não expirou. Não gasta nada. */
	find(tokenHash: string, now: Date): Promise<PluggyConnectSessionRecord | null>;
	/** Gasta a sessão (uso único), de forma atômica. `false` se não existe, expirou ou já foi usada. */
	consume(tokenHash: string, now: Date): Promise<boolean>;
	/** Desfaz um `consume` cujo trabalho seguinte falhou, para a pessoa poder tentar de novo. */
	release(tokenHash: string): Promise<void>;
	/** Apaga sessões usadas ou expiradas antes de `before`. Devolve quantas apagou. */
	deleteStale(before: Date): Promise<number>;
}
