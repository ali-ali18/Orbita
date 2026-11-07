import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, call, UNREACHABLE_MESSAGE } from "../../lib/api.ts";
import { useSession } from "../../lib/session.tsx";
import { isAffectedByBudget, type SetRequest } from "./budget-model.ts";

function useScoped() {
	const { api, baseUrl } = useSession();
	if (!api || !baseUrl) throw new Error("Consulta sem sessão");
	return { api, baseUrl };
}

export function useBudgets() {
	const { api, baseUrl } = useScoped();
	return useQuery({ queryKey: [baseUrl, "budgets"], queryFn: () => call(() => api.v1.budgets.$get()) });
}

function useRefreshAfter() {
	const { baseUrl } = useSession();
	const queryClient = useQueryClient();
	return () =>
		queryClient.invalidateQueries({
			predicate: (q) => baseUrl !== null && isAffectedByBudget(q.queryKey, baseUrl),
		});
}

/** Criar e trocar o limite são o mesmo PUT. */
export function useSetBudget() {
	const { api } = useSession();
	const refresh = useRefreshAfter();
	return useMutation({
		mutationFn: async (request: SetRequest) => {
			if (!api) throw new Error("Orçamento sem sessão");
			await call(() => api.v1.budgets.$put({ json: request }));
		},
		onSuccess: () => {
			void refresh();
		},
	});
}

export function useRemoveBudget() {
	const { api } = useSession();
	const refresh = useRefreshAfter();
	return useMutation({
		mutationFn: async (scope: string) => {
			if (!api) throw new Error("Orçamento sem sessão");
			// O DELETE responde 204 sem corpo, então `call` (que lê JSON) só entra para montar o erro.
			let res: Awaited<ReturnType<(typeof api.v1.budgets)[":scope"]["$delete"]>>;
			try {
				res = await api.v1.budgets[":scope"].$delete({ param: { scope } });
			} catch {
				throw new ApiError(UNREACHABLE_MESSAGE, null, "sem_conexao");
			}
			// 404 = já não existia: o resultado é o que o usuário queria.
			const status: number = res.status;
			if (!res.ok && status !== 404) await call(async () => res);
		},
		onSuccess: () => {
			void refresh();
		},
	});
}
