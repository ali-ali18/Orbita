import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { call } from "../../lib/api.ts";
import { useSession } from "../../lib/session.tsx";
import { isAffectedByNewTransaction } from "../transactions/new-transaction-model.ts";

/** Pendentes (`GET /v1/transactions/pending`). A chave começa por transactions, então confirmar recarrega. */
export function usePendingTransactions() {
	const { api, baseUrl } = useSession();
	if (!api || !baseUrl) throw new Error("Consulta sem sessão");
	return useQuery({
		queryKey: [baseUrl, "transactions", "pending"],
		queryFn: () => call(() => api.v1.transactions.pending.$get({ query: { limit: "200" } })),
	});
}

/** Confirma um pendente. A lista, o Início e as Atividades recarregam. */
export function useConfirmPending() {
	const { api, baseUrl } = useSession();
	const queryClient = useQueryClient();
	if (!api || !baseUrl) throw new Error("Confirmação sem sessão");
	return useMutation({
		mutationFn: (id: string) => call(() => api.v1.transactions[":id"].confirm.$post({ param: { id } })),
		onSuccess: () => {
			void queryClient.invalidateQueries({
				predicate: (query) => isAffectedByNewTransaction(query.queryKey, baseUrl),
			});
		},
	});
}
