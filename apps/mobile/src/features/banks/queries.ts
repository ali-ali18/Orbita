import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { call } from "../../lib/api.ts";
import { useSession } from "../../lib/session.tsx";
import { isHomeQuery, nextPollDelay, type SyncState, shouldRefreshHome } from "./banks-model.ts";

function useScoped() {
	const { api, baseUrl } = useSession();
	if (!api || !baseUrl) throw new Error("Consulta sem sessão");
	return { api, baseUrl };
}

/**
 * Estado do Meu Pluggy: chaves, sincronização e conexões numa chamada só. Enquanto há sincronização
 * em andamento atualiza a cada 3 s, por no máximo 5 min; parou, ou saiu da tela, para de perguntar.
 * Quando uma sincronização termina com dado novo, recarrega o Início.
 */
export function usePluggyStatus() {
	const { api, baseUrl } = useScoped();
	const queryClient = useQueryClient();
	const activeSince = useRef<number | null>(null);
	const previous = useRef<SyncState | undefined>(undefined);

	const query = useQuery({
		queryKey: [baseUrl, "pluggy", "status"],
		// Entrar na tela mostra o estado de agora, não o de 30 s atrás.
		staleTime: 0,
		queryFn: () => call(() => api.v1.pluggy.status.$get()),
		refetchInterval: (q) => {
			const sync = q.state.data?.sync;
			if (sync !== "queued" && sync !== "running") {
				activeSince.current = null;
				return false;
			}
			activeSince.current ??= Date.now();
			return nextPollDelay(sync, Date.now() - activeSince.current);
		},
	});

	const data = query.data;
	useEffect(() => {
		if (!data) return;
		if (shouldRefreshHome(previous.current, data)) {
			void queryClient.invalidateQueries({ predicate: (q) => isHomeQuery(q.queryKey, baseUrl) });
		}
		previous.current = data.sync;
	}, [data, queryClient, baseUrl]);

	return query;
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
		onSuccess: refresh,
	});
	const remove = useMutation({
		mutationFn: (id: string) => call(() => api.v1.pluggy.connections[":id"].$delete({ param: { id } })),
		onSuccess: refresh,
	});
	return { sync, add, remove };
}
