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
	/** Código ainda utilizável: não usado, não expirado e com tentativas sobrando (`attempts < maxAttempts`). */
	findActivePairingCode(now: Date, maxAttempts: number): Promise<PairingCodeRecord | null>;
	/**
	 * Reserva uma tentativa de forma atômica, ANTES de comparar o palpite: só incrementa
	 * `attempts` se o código segue vivo e abaixo do limite. `false` = sem tentativa
	 * disponível, e o palpite não pode nem ser comparado. Assim, palpites concorrentes
	 * nunca passam de `maxAttempts` no total.
	 */
	reserveAttempt(input: { codeId: string; maxAttempts: number; now: Date }): Promise<boolean>;
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
	/** Aparelhos ainda conectados (não revogados). Zero significa servidor sem dono. */
	countActiveDevices(): Promise<number>;
	/** Apaga códigos usados ou expirados antes de `before`. Devolve quantos apagou. */
	deleteStalePairingCodes(before: Date): Promise<number>;
}
