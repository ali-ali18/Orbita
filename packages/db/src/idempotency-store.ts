export interface IdempotencyRecord {
	key: string;
	deviceId: string;
	/** Hash do pedido (método, caminho e corpo): a mesma chave com outro pedido é um erro do cliente. */
	requestHash: string;
	/** `null` enquanto o primeiro pedido ainda está sendo processado. */
	status: number | null;
	/** Corpo da resposta (JSON em texto); `null` enquanto o pedido não terminou. */
	body: string | null;
	createdAt: Date;
	expiresAt: Date;
}

export type IdempotencyBegin =
	| { outcome: "started" }
	/** Já existe um registro vivo para a chave: quem chamou decide entre repetir a resposta, recusar ou esperar. */
	| { outcome: "existing"; record: IdempotencyRecord };

/**
 * Chaves de idempotência (`Idempotency-Key`) dos pedidos que criam coisas. Uma chave vale por aparelho: a
 * unicidade de (aparelho, chave) garante que dois pedidos simultâneos nunca executem os dois.
 */
export interface IdempotencyStore {
	/**
	 * Reserva a chave, de forma atômica. `started`: este pedido é o dono e deve executar e depois chamar
	 * `complete` (ou `release` se falhar). `existing`: outro pedido já a reservou.
	 * Uma reserva é retomada (vira `started` de novo) se já expirou ou se ficou sem resposta desde antes de
	 * `staleBefore` (o processo que a fez provavelmente caiu).
	 */
	begin(input: {
		key: string;
		deviceId: string;
		requestHash: string;
		now: Date;
		expiresAt: Date;
		staleBefore: Date;
	}): Promise<IdempotencyBegin>;
	/** Guarda a resposta da reserva em andamento. */
	complete(input: { key: string; deviceId: string; status: number; body: string }): Promise<void>;
	/** Desfaz uma reserva ainda sem resposta (o pedido falhou), para a pessoa poder tentar de novo. */
	release(input: { key: string; deviceId: string }): Promise<void>;
	/** Apaga as chaves que expiraram antes de `before`. Devolve quantas apagou. */
	deleteExpired(before: Date): Promise<number>;
}
