import { focusManager, MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { AppState } from "react-native";
import { ApiError } from "./api.ts";

/** Erro da API (HTTP) não melhora tentando de novo; só rede fora do ar vale uma nova tentativa. */
export function shouldRetry(count: number, error: unknown): boolean {
	return !(error instanceof ApiError && error.status !== null) && count < 2;
}

/** `onError` recebe o erro de QUALQUER consulta ou gravação (usado para sair da sessão no 401, uma vez só). */
export function createAppQueryClient(onError: (error: unknown) => void): QueryClient {
	return new QueryClient({
		queryCache: new QueryCache({ onError }),
		mutationCache: new MutationCache({ onError }),
		defaultOptions: { queries: { staleTime: 30_000, retry: shouldRetry } },
	});
}

/** No celular o "foco" é o app estar no primeiro plano: voltar dele refaz as consultas velhas. */
export function bindFocusToAppState(): () => void {
	const sub = AppState.addEventListener("change", (s) => focusManager.setFocused(s === "active"));
	return () => sub.remove();
}
