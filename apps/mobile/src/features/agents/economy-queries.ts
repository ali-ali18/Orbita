import type { SavingsActBody } from "@orbita/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { call } from "../../lib/api.ts";
import { useSession } from "../../lib/session.tsx";

function useScoped() {
	const { api, baseUrl } = useSession();
	if (!api || !baseUrl) throw new Error("Consulta sem sessão");
	return { api, baseUrl };
}

/** "Onde cortar": os achados do engine, já com texto e ações. Só vale com o servidor, nada é calculado no app. */
export function useSavings() {
	const { api, baseUrl } = useScoped();
	return useQuery({
		queryKey: [baseUrl, "economy", "savings"],
		queryFn: () => call(() => api.v1.savings.$get()),
	});
}

/** O que o agente fez sozinho, do mais novo para o mais antigo. */
export function useActivities() {
	const { api, baseUrl } = useScoped();
	return useQuery({
		queryKey: [baseUrl, "economy", "activity"],
		queryFn: () => call(() => api.v1["agent-activity"].$get({ query: {} })),
	});
}

/** Tudo que o Economia mexe (lançamentos, orçamento, metas, assinaturas) pode ter mudado: recarrega o que é do servidor. */
function useRefreshAll() {
	const { baseUrl } = useSession();
	const queryClient = useQueryClient();
	return () =>
		queryClient.invalidateQueries({ predicate: (q) => baseUrl !== null && q.queryKey[0] === baseUrl });
}

export function useIgnoreOpportunity() {
	const { api } = useSession();
	const refresh = useRefreshAll();
	return useMutation({
		mutationFn: async (key: string) => {
			if (!api) throw new Error("Sem sessão");
			return await call(() => api.v1.savings.ignore.$post({ json: { key } }));
		},
		onSuccess: () => {
			void refresh();
		},
	});
}

export function useActOnOpportunity() {
	const { api } = useSession();
	const refresh = useRefreshAll();
	return useMutation({
		mutationFn: async (body: SavingsActBody) => {
			if (!api) throw new Error("Sem sessão");
			return await call(() => api.v1.savings.act.$post({ json: body }));
		},
		onSuccess: () => {
			void refresh();
		},
	});
}

export function useUndoActivity() {
	const { api } = useSession();
	const refresh = useRefreshAll();
	return useMutation({
		mutationFn: async (id: string) => {
			if (!api) throw new Error("Sem sessão");
			return await call(() => api.v1["agent-activity"][":id"].undo.$post({ param: { id } }));
		},
		onSuccess: () => {
			void refresh();
		},
	});
}
