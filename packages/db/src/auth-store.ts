export type DeviceRecord = {
	id: string;
	name: string;
	tokenHash: string;
	createdAt: Date;
	lastSeenAt: Date | null;
	revokedAt: Date | null;
};

export type PairingCodeRecord = {
	id: string;
	codeHash: string;
	expiresAt: Date;
	attempts: number;
	usedAt: Date | null;
};

/**
 * Acesso a dados do pareamento e dos aparelhos. A API e o worker dependem só
 * desta interface; o Postgres e a memória (testes) a implementam.
 */
export interface AuthStore {
	/** Cria um código novo e expira os anteriores: só um código fica ativo por vez. */
	replaceActivePairingCode(input: {
		codeHash: string;
		expiresAt: Date;
		now: Date;
	}): Promise<PairingCodeRecord>;
	findActivePairingCode(now: Date): Promise<PairingCodeRecord | null>;
	/** Conta uma tentativa errada; ao chegar em `maxAttempts`, o código morre. */
	registerFailedAttempt(input: { codeId: string; maxAttempts: number; now: Date }): Promise<void>;
	/**
	 * Gasta o código e cria o aparelho numa operação só. Devolve `null` se o
	 * código já foi usado, expirou ou foi trocado (corrida entre dois pedidos).
	 */
	consumePairingCode(input: {
		codeId: string;
		now: Date;
		deviceName: string;
		tokenHash: string;
	}): Promise<DeviceRecord | null>;
	findDeviceByTokenHash(tokenHash: string): Promise<DeviceRecord | null>;
	touchDevice(input: { deviceId: string; now: Date }): Promise<void>;
	revokeDevice(input: { deviceId: string; now: Date }): Promise<void>;
	/** Apaga códigos usados ou expirados antes de `before`. Devolve quantos apagou. */
	deleteStalePairingCodes(before: Date): Promise<number>;
}
