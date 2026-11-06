import { ApiError } from "./api.ts";

export const isUnauthorized = (error: unknown): boolean => error instanceof ApiError && error.status === 401;

/**
 * Dispara `onUnauthorized` uma vez só, mesmo que várias consultas falhem com 401 ao mesmo tempo.
 * `reset()` rearma (depois de um novo login).
 */
export function createUnauthorizedGuard(onUnauthorized: () => void) {
	let fired = false;
	return {
		handle(error: unknown) {
			if (fired || !isUnauthorized(error)) return;
			fired = true;
			onUnauthorized();
		},
		reset() {
			fired = false;
		},
	};
}
