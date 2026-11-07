import { useQueries } from "@tanstack/react-query";
import { call } from "../../lib/api.ts";
import { useSession } from "../../lib/session.tsx";

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
