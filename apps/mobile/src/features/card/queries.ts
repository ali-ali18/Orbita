import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { call } from "../../lib/api.ts";
import { IDEMPOTENCY_HEADER } from "../../lib/idempotency.ts";
import { shouldRetry } from "../../lib/query-client.ts";
import { useSession } from "../../lib/session.tsx";
import { isAffectedByInvoicePayment } from "./card-model.ts";

/** Faturas de vários (cartão, mês) de uma vez. Mesma chave de `useInvoice`: o cache é dividido com o Início e as Faturas. */
export function useInvoiceTotals(pairs: readonly { cardId: string; month: string }[]) {
	const { api, baseUrl } = useSession();
	if (!api || !baseUrl) throw new Error("Consulta sem sessão");
	return useQueries({
		queries: pairs.map(({ cardId, month }) => ({
			queryKey: [baseUrl, "invoice", cardId, month],
			queryFn: () =>
				call(() => api.v1.cards[":id"].invoices[":month"].$get({ param: { id: cardId, month } })),
		})),
	});
}

function useRefreshAfterPayment() {
	const { baseUrl } = useSession();
	const queryClient = useQueryClient();
	return () =>
		queryClient.invalidateQueries({
			predicate: (q) => baseUrl !== null && isAffectedByInvoicePayment(q.queryKey, baseUrl),
		});
}

/**
 * "Marcar como paga": o servidor lança o pagamento do que falta da fatura, da conta escolhida. A chave de
 * idempotência faz repetir o pedido (rede que cai) ser seguro. Devolve o id do lançamento, base do "Desfazer".
 */
export function usePayInvoice() {
	const { api } = useSession();
	const refresh = useRefreshAfterPayment();
	return useMutation({
		retry: shouldRetry,
		mutationFn: async (input: {
			cardId: string;
			month: string;
			accountId: string;
			idempotencyKey: string;
		}) => {
			if (!api) throw new Error("Pagamento sem sessão");
			const { transaction } = await call(() =>
				api.v1.cards[":id"].invoices[":month"].pay.$post(
					{ param: { id: input.cardId, month: input.month }, json: { accountId: input.accountId } },
					{ headers: { [IDEMPOTENCY_HEADER]: input.idempotencyKey } },
				),
			);
			return transaction.id;
		},
		onSettled: () => {
			void refresh();
		},
	});
}

/** "Desfazer": apaga o pagamento que acabou de ser lançado (a fatura volta ao que era). */
export function useUndoInvoicePayment() {
	const { api } = useSession();
	const refresh = useRefreshAfterPayment();
	return useMutation({
		mutationFn: async (transactionId: string) => {
			if (!api) throw new Error("Pagamento sem sessão");
			await call(() =>
				api.v1.transactions[":id"].$delete({ param: { id: transactionId }, query: { scope: "item" } }),
			);
		},
		onSettled: () => {
			void refresh();
		},
	});
}
