import { useMutation, useQueryClient } from "@tanstack/react-query";
import { call } from "../../lib/api.ts";
import { useSession } from "../../lib/session.tsx";
import { isAffectedByNewTransaction, type SubmitRequest } from "./new-transaction-model.ts";

/** Salva o lançamento (à vista ou parcelado) e atualiza o que o Início mostra. */
export function useCreateTransaction() {
	const { api, baseUrl } = useSession();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (request: SubmitRequest) => {
			if (!api) throw new Error("Lançamento sem sessão");
			if (request.type === "installments") {
				await call(() => api.v1.transactions.installments.$post({ json: request.body }));
			} else {
				await call(() => api.v1.transactions.$post({ json: request.body }));
			}
		},
		// Sem `return`: a tela fecha na hora; o Início recarrega em segundo plano.
		onSuccess: () => {
			void queryClient.invalidateQueries({
				predicate: (q) => baseUrl !== null && isAffectedByNewTransaction(q.queryKey, baseUrl),
			});
		},
	});
}
