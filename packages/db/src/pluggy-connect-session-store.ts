/**
 * Sessões do "Conectar banco" (Pluggy Connect). O app pede uma ao servidor e entrega o token à página web do
 * widget; a página o devolve ao servidor para provar que veio do app. No banco fica só o hash do token.
 */
export interface PluggyConnectSessionStore {
	/** Cria a sessão e expira as anteriores ainda vivas: só uma fica ativa por vez. Apaga as velhas. */
	create(input: { tokenHash: string; expiresAt: Date; now: Date }): Promise<void>;
	/** A sessão existe, não foi usada e não expirou. Não gasta nada. */
	isActive(tokenHash: string, now: Date): Promise<boolean>;
	/** Gasta a sessão (uso único), de forma atômica. `false` se não existe, expirou ou já foi usada. */
	consume(tokenHash: string, now: Date): Promise<boolean>;
	/** Apaga sessões usadas ou expiradas antes de `before`. Devolve quantas apagou. */
	deleteStale(before: Date): Promise<number>;
}
