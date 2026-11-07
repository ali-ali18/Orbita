import type { TransactionApiUpdateBody } from "@orbita/shared";
import { type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query";
import { call, type TransactionView } from "../../lib/api.ts";
import { useSession } from "../../lib/session.tsx";
import type { DeleteScope } from "./detail-model.ts";
import { isAffectedByNewTransaction } from "./new-transaction-model.ts";

/**
 * Depois de salvar ou apagar, o Início e as Atividades recarregam em segundo plano. O detalhe aberto
 * fica de fora: ele já recebe a resposta do servidor (ou está saindo da tela, e um GET de um
 * lançamento apagado daria 404).
 */
function invalidateLists(queryClient: QueryClient, baseUrl: string | null) {
	void queryClient.invalidateQueries({
		predicate: (q) =>
			baseUrl !== null && isAffectedByNewTransaction(q.queryKey, baseUrl) && q.queryKey[2] !== "detail",
	});
}

function useDetailMutations() {
	const { api, baseUrl } = useSession();
	const queryClient = useQueryClient();
	if (!api) throw new Error("Lançamento sem sessão");
	const detailKey = (id: string) => [baseUrl, "transactions", "detail", id];
	const keep = (id: string, data: TransactionView) => {
		queryClient.setQueryData(detailKey(id), data);
		invalidateLists(queryClient, baseUrl);
	};
	return { api, baseUrl, queryClient, keep };
}

/** PATCH: categoria, descrição ou nota. */
export function useUpdateTransaction(id: string) {
	const { api, keep } = useDetailMutations();
	return useMutation({
		mutationFn: (body: TransactionApiUpdateBody) =>
			call(() => api.v1.transactions[":id"].$patch({ param: { id }, json: body })),
		onSuccess: (data) => keep(id, data),
	});
}

/** Cria a regra "esta loja é desta categoria" e reclassifica os outros lançamentos dela; devolve quantos mudaram. */
export function useApplyCategoryRule(transactionId: string) {
	const { api, baseUrl, queryClient } = useDetailMutations();
	return useMutation({
		mutationFn: (categoryId: string) =>
			call(() =>
				api.v1["category-rules"].$post({
					json: { transactionId, categoryId, applyToExisting: true },
				}),
			),
		onSuccess: () => {
			invalidateLists(queryClient, baseUrl);
		},
	});
}

/** Pendente vira confirmado. */
export function useConfirmTransaction(id: string) {
	const { api, keep } = useDetailMutations();
	return useMutation({
		mutationFn: () => call(() => api.v1.transactions[":id"].confirm.$post({ param: { id } })),
		onSuccess: (data) => keep(id, data),
	});
}

/** Apaga só este lançamento ou, numa parcela, o parcelamento inteiro. */
export function useDeleteTransaction(id: string) {
	const { api, baseUrl, queryClient } = useDetailMutations();
	return useMutation({
		mutationFn: (scope: DeleteScope) =>
			call(() => api.v1.transactions[":id"].$delete({ param: { id }, query: { scope } })),
		onSuccess: () => {
			invalidateLists(queryClient, baseUrl);
		},
	});
}
