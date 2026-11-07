import type { SecretName } from "@orbita/shared";
import { useQueryClient } from "@tanstack/react-query";
import { call } from "../../lib/api.ts";
import { useSession } from "../../lib/session.tsx";

/**
 * Grava e remove chaves. De propósito NÃO usa `useMutation`: ele guarda as variáveis (o valor da chave)
 * no cache do Query. Aqui o valor só passa pela chamada e é descartado; só o estado das chaves é recarregado.
 */
export function useSecretActions() {
	const { api, baseUrl } = useSession();
	const queryClient = useQueryClient();
	const refresh = () => queryClient.invalidateQueries({ queryKey: [baseUrl, "settings", "secrets"] });

	return {
		async save(name: SecretName, value: string): Promise<void> {
			if (!api) throw new Error("Sem sessão");
			await call(() => api.v1.settings.secrets[":name"].$put({ param: { name }, json: { value } }));
			await refresh();
		},
		async remove(name: SecretName): Promise<void> {
			if (!api) throw new Error("Sem sessão");
			await call(() => api.v1.settings.secrets[":name"].$delete({ param: { name } }));
			await refresh();
		},
	};
}
