import type { SecretName } from "@orbita/shared";

export interface SecretActions {
	save(name: SecretName, value: string): Promise<void>;
	remove(name: SecretName): Promise<void>;
}

/**
 * Grava e remove chaves. De propósito NÃO usa `useMutation`: ele guarda as variáveis (o valor da chave)
 * no cache do Query. Em troca, o erro passa por `onError` (o mesmo tratamento de 401 das consultas,
 * que encerra a sessão) e só o estado das chaves é recarregado depois.
 */
export function createSecretActions({
	put,
	del,
	onError,
	refresh,
}: {
	put: (name: SecretName, value: string) => Promise<unknown>;
	del: (name: SecretName) => Promise<unknown>;
	onError: (error: unknown) => void;
	refresh: () => Promise<unknown>;
}): SecretActions {
	const guarded = async (run: () => Promise<unknown>) => {
		try {
			await run();
		} catch (error) {
			onError(error);
			throw error;
		}
		await refresh();
	};
	return {
		save: (name, value) => guarded(() => put(name, value)),
		remove: (name) => guarded(() => del(name)),
	};
}
