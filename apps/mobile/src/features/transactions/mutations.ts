import { useMutation, useQueryClient } from "@tanstack/react-query";
import { call } from "../../lib/api.ts";
import { IDEMPOTENCY_HEADER } from "../../lib/idempotency.ts";
import { shouldRetry } from "../../lib/query-client.ts";
import { useSession } from "../../lib/session.tsx";
import { isAffectedByNewTransaction, type SubmitRequest } from "./new-transaction-model.ts";

/** Um "salvar": o pedido e a chave de idempotência dele (a mesma em toda nova tentativa). */
export interface CreateTransactionVariables {
	request: SubmitRequest;
	idempotencyKey: string;
}

/**
 * Salva o lançamento (à vista ou parcelado) e atualiza o que o Início mostra. Com a chave, repetir o pedido é
 * seguro: se a resposta se perder na rede, tentar de novo não grava em dobro. Por isso a rede que cai é
 * repetida sozinha (até 2 vezes); erro da API não.
 */
export function useCreateTransaction() {
	const { api, baseUrl } = useSession();
	const queryClient = useQueryClient();
	return useMutation({
		retry: shouldRetry,
		mutationFn: async ({ request, idempotencyKey }: CreateTransactionVariables) => {
			if (!api) throw new Error("Lançamento sem sessão");
			const options = { headers: { [IDEMPOTENCY_HEADER]: idempotencyKey } };
			if (request.type === "installments") {
				await call(() => api.v1.transactions.installments.$post({ json: request.body }, options));
			} else {
				await call(() => api.v1.transactions.$post({ json: request.body }, options));
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
