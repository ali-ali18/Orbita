import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { call } from "../../lib/api.ts";
import { useSession } from "../../lib/session.tsx";
import { isAffectedBySubscription, type SaveRequest } from "./subscriptions-model.ts";

function useScoped() {
	const { api, baseUrl } = useSession();
	if (!api || !baseUrl) throw new Error("Consulta sem sessão");
	return { api, baseUrl };
}

export function useRecurrences() {
	const { api, baseUrl } = useScoped();
	return useQuery({
		queryKey: [baseUrl, "recurrences"],
		queryFn: () => call(() => api.v1.recurrences.$get()),
	});
}

/** Lançamentos do mês (pelo mês do orçamento): base para saber quais assinaturas já foram lançadas. */
export function useMonthTransactions(month: string) {
	const { api, baseUrl } = useScoped();
	return useQuery({
		queryKey: [baseUrl, "month-transactions", month],
		queryFn: () => call(() => api.v1.transactions.month[":month"].$get({ param: { month } })),
	});
}

/** Depois de salvar, arquivar ou lançar: o resumo do Início (reserva do mês) e as listas recarregam. */
function refresh(queryClient: QueryClient, baseUrl: string | null): Promise<void> {
	return queryClient.invalidateQueries({
		predicate: (q) => baseUrl !== null && isAffectedBySubscription(q.queryKey, baseUrl),
	});
}

export function useSaveSubscription() {
	const { api, baseUrl } = useSession();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (request: SaveRequest) => {
			if (!api) throw new Error("Assinatura sem sessão");
			if (request.type === "create") {
				await call(() => api.v1.recurrences.$post({ json: request.body }));
			} else {
				await call(() => api.v1.recurrences[":id"].$patch({ param: { id: request.id }, json: request.body }));
			}
		},
		onSuccess: () => {
			void refresh(queryClient, baseUrl);
		},
	});
}

export function useArchiveSubscription() {
	const { api, baseUrl } = useSession();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (id: string) => {
			if (!api) throw new Error("Assinatura sem sessão");
			await call(() => api.v1.recurrences[":id"].$delete({ param: { id } }));
		},
		onSuccess: () => {
			void refresh(queryClient, baseUrl);
		},
	});
}

/** "Lançar agora": cria o lançamento do mês. 409 = já estava lançada; a lista recarrega de qualquer jeito. */
export function usePostSubscription() {
	const { api, baseUrl } = useSession();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (input: { id: string; month: string }) => {
			if (!api) throw new Error("Assinatura sem sessão");
			await call(() =>
				api.v1.recurrences[":id"].post.$post({ param: { id: input.id }, json: { month: input.month } }),
			);
		},
		onSettled: () => {
			void refresh(queryClient, baseUrl);
		},
	});
}
