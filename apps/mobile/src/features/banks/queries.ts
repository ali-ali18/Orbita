import type { PluggyStatusResponse } from "@orbita/shared";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { call } from "../../lib/api.ts";
import { useSession } from "../../lib/session.tsx";
import {
	homeRefreshDecision,
	isHomeQuery,
	isSyncActive,
	nextPollDelay,
	type SyncState,
} from "./banks-model.ts";

function useScoped() {
	const { api, baseUrl } = useSession();
	if (!api || !baseUrl) throw new Error("Consulta sem sessão");
	return { api, baseUrl };
}

export type PluggyStatus = PluggyStatusResponse;

/**
 * Compara o status com a assinatura da última vez que o Início foi tratado e recarrega o Início se
 * mudou. A assinatura mora no QueryClient (não numa tela): vale para a sincronização do botão e para a diária.
 */
export function reconcileHome(queryClient: QueryClient, baseUrl: string, status: PluggyStatus): void {
	const key = [baseUrl, "pluggy", "home-signature"];
	// Sem observador o cache apagaria a assinatura em 5 min; ela tem de durar a sessão do app.
	queryClient.setQueryDefaults(key, { gcTime: Number.POSITIVE_INFINITY });
	const decision = homeRefreshDecision(queryClient.getQueryData<string>(key), status);
	if (decision.seen !== undefined) queryClient.setQueryData(key, decision.seen);
	if (decision.reload) {
		void queryClient.invalidateQueries({ predicate: (q) => isHomeQuery(q.queryKey, baseUrl) });
	}
}

/**
 * Estado do Meu Pluggy: chaves, sincronização e conexões numa chamada só. Enquanto há sincronização
 * em andamento atualiza a cada 3 s (a cada 30 s depois de 5 min); sem nada em andamento, ou fora da tela, não pergunta.
 */
export function usePluggyStatus() {
	const { api, baseUrl } = useScoped();
	const queryClient = useQueryClient();
	const activeSince = useRef<number | null>(null);

	const query = useQuery({
		queryKey: [baseUrl, "pluggy", "status"],
		// Entrar na tela mostra o estado de agora, não o de 30 s atrás.
		staleTime: 0,
		queryFn: () => call(() => api.v1.pluggy.status.$get()),
		refetchInterval: (q) => {
			const sync = q.state.data?.sync;
			if (!isSyncActive(sync)) {
				activeSince.current = null;
				return false;
			}
			activeSince.current ??= Date.now();
			return nextPollDelay(sync, Date.now() - activeSince.current);
		},
	});

	const data = query.data;
	useEffect(() => {
		if (data) reconcileHome(queryClient, baseUrl, data);
	}, [data, queryClient, baseUrl]);

	return query;
}

/**
 * Para o Início: ao abrir e ao voltar ao app, confere o Meu Pluggy e recarrega o que a sincronização
 * (a diária inclusive) mudou enquanto o app estava fora. Falha aqui nunca aparece: o Início segue como está.
 */
export function usePluggyHomeWatch() {
	const { api, baseUrl } = useScoped();
	const queryClient = useQueryClient();
	useEffect(() => {
		const check = () => {
			queryClient
				.fetchQuery({
					queryKey: [baseUrl, "pluggy", "status"],
					staleTime: 0,
					queryFn: () => call(() => api.v1.pluggy.status.$get()),
				})
				.then((status) => reconcileHome(queryClient, baseUrl, status))
				.catch(() => {});
		};
		check();
		const sub = AppState.addEventListener("change", (s) => s === "active" && check());
		return () => sub.remove();
	}, [api, baseUrl, queryClient]);
}

export function usePluggyActions() {
	const { api, baseUrl } = useScoped();
	const queryClient = useQueryClient();
	const statusKey = [baseUrl, "pluggy", "status"];
	const refresh = () => queryClient.invalidateQueries({ queryKey: statusKey });

	// Erro 401 de qualquer um encerra a sessão pelo MutationCache; o resto volta para a tela.
	const sync = useMutation({
		mutationFn: () => call(() => api.v1.pluggy.sync.$post()),
		onSuccess: async (result) => {
			// Mostra "Na fila" já; o polling do status assume daí.
			queryClient.setQueryData(statusKey, (old: { sync: SyncState } | undefined) =>
				old ? { ...old, sync: result.sync } : old,
			);
			await refresh();
		},
	});
	const add = useMutation({
		mutationFn: (json: { itemId: string; label?: string }) =>
			call(() => api.v1.pluggy.connections.$post({ json })),
		onSettled: refresh,
	});
	const remove = useMutation({
		mutationFn: (id: string) => call(() => api.v1.pluggy.connections[":id"].$delete({ param: { id } })),
		onSettled: refresh,
	});
	// Cria a sessão de uso único; quem abre o navegador é a tela.
	const connect = useMutation({
		mutationFn: () => call(() => api.v1.pluggy["connect-sessions"].$post()),
	});
	return { sync, add, remove, connect };
}
