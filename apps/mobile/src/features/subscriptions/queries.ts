import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, call } from "../../lib/api.ts";
import { useSession } from "../../lib/session.tsx";
import { type BatchPostResult, isAffectedBySubscription, type SaveRequest } from "./subscriptions-model.ts";

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

/**
 * "Lançar todas": uma por vez (o servidor decide o que já existe). 409 = já estava lançada, conta como
 * sucesso; outro erro entra em `failed` e não impede as demais.
 */
export function usePostAllSubscriptions() {
	const { api, baseUrl } = useSession();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (input: { ids: readonly string[]; month: string }): Promise<BatchPostResult> => {
			if (!api) throw new Error("Assinatura sem sessão");
			const result: BatchPostResult = { transactionIds: [], already: 0, failed: 0 };
			for (const id of input.ids) {
				try {
					const created = await call(() =>
						api.v1.recurrences[":id"].post.$post({ param: { id }, json: { month: input.month } }),
					);
					result.transactionIds.push(created.transaction.id);
				} catch (error) {
					if (error instanceof ApiError && error.status === 409) result.already += 1;
					else result.failed += 1;
				}
			}
			return result;
		},
		onSettled: () => {
			void refresh(queryClient, baseUrl);
		},
	});
}

/** "Desfazer" do "Lançar todas": apaga só os lançamentos criados agora (o mesmo caminho do desfazer do chat). */
export function useUndoPostedSubscriptions() {
	const { api, baseUrl } = useSession();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (transactionIds: readonly string[]) => {
			if (!api) throw new Error("Assinatura sem sessão");
			for (const id of transactionIds) {
				await call(() => api.v1.transactions[":id"].$delete({ param: { id }, query: { scope: "item" } }));
			}
		},
		onSettled: () => {
			void refresh(queryClient, baseUrl);
		},
	});
}
