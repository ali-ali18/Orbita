/** Cabeçalho que a API usa para não gravar duas vezes o mesmo "salvar" (rede que cai no meio do pedido). */
export const IDEMPOTENCY_HEADER = "Idempotency-Key";

/** Fonte de bytes aleatórios; injetável para testar. */
export type RandomBytes = (length: number) => Uint8Array;

const defaultRandomBytes: RandomBytes = (length) => {
	const bytes = new Uint8Array(length);
	const webCrypto = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
	if (webCrypto?.getRandomValues) return webCrypto.getRandomValues(bytes);
	// A chave não é segredo, só precisa ser única por tentativa: o fallback basta.
	for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
	return bytes;
};

/** UUID v4 (o formato que a API exige). */
export function newIdempotencyKey(randomBytes: RandomBytes = defaultRandomBytes): string {
	const b = randomBytes(16);
	b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
	b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
	const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * A chave de uma tentativa de salvar. Toques repetidos e novas tentativas depois de erro de rede usam a mesma
 * chave (o servidor devolve o que já gravou); `renew` é chamado quando o pedido muda ou termina, e a próxima
 * tentativa ganha chave nova.
 */
export function createSubmissionKey(generate: () => string = newIdempotencyKey) {
	let current: string | null = null;
	return {
		current(): string {
			current ??= generate();
			return current;
		},
		renew(): void {
			current = null;
		},
	};
}
