export type RateLimitResult = { allowed: boolean; retryAfterMs: number };

export type RateLimiter = {
	hit(key: string): RateLimitResult;
	/** Diz se o próximo `hit` passaria, sem contar nada. */
	peek(key: string): RateLimitResult;
	/** Quantas chaves estão guardadas agora (para testes e métricas). */
	size(): number;
};

type Options = {
	limit: number;
	windowMs: number;
	now: () => number;
	/** Teto de chaves em memória; ao passar, as mais antigas saem. */
	maxKeys?: number;
};

const DEFAULT_MAX_KEYS = 10_000;

/**
 * Janela fixa em memória. Serve para uma instância só (o servidor é um processo);
 * se um dia houver várias, o contador passa para o Redis.
 */
export function createRateLimiter({
	limit,
	windowMs,
	now,
	maxKeys = DEFAULT_MAX_KEYS,
}: Options): RateLimiter {
	// Map preserva a ordem de inserção: a primeira chave é sempre a mais antiga.
	const windows = new Map<string, { start: number; count: number }>();
	let lastPrune = now();

	function prune(t: number) {
		for (const [key, w] of windows) {
			if (t - w.start >= windowMs) windows.delete(key);
			else break; // as seguintes são mais novas
		}
		lastPrune = t;
	}

	return {
		peek(key) {
			const t = now();
			const w = windows.get(key);
			if (!w || t - w.start >= windowMs || w.count < limit) return { allowed: true, retryAfterMs: 0 };
			return { allowed: false, retryAfterMs: Math.max(0, w.start + windowMs - t) };
		},
		hit(key) {
			const t = now();
			if (t - lastPrune >= windowMs) prune(t);

			let w = windows.get(key);
			if (!w || t - w.start >= windowMs) {
				// Reinserir move a chave para o fim, mantendo a ordem por início de janela.
				windows.delete(key);
				w = { start: t, count: 0 };
				windows.set(key, w);
				while (windows.size > maxKeys) {
					const oldest = windows.keys().next().value;
					if (oldest === undefined) break;
					windows.delete(oldest);
				}
			}
			w.count += 1;
			if (w.count > limit) return { allowed: false, retryAfterMs: Math.max(0, w.start + windowMs - t) };
			return { allowed: true, retryAfterMs: 0 };
		},
		size: () => windows.size,
	};
}
