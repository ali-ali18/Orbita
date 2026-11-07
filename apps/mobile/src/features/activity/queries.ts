import { useInfiniteQuery } from "@tanstack/react-query";
import { call } from "../../lib/api.ts";
import { useSession } from "../../lib/session.tsx";
import { PAGE_SIZE } from "./activity-model.ts";

/**
 * Lançamentos em páginas (`GET /v1/transactions?cursor&limit`, mais novo primeiro). A chave começa por
 * `[baseUrl, "transactions"]`: entrar um lançamento novo ou terminar uma sincronização recarrega a lista.
 */
export function useActivityTransactions() {
	const { api, baseUrl } = useSession();
	if (!api || !baseUrl) throw new Error("Consulta sem sessão");
	return useInfiniteQuery({
		queryKey: [baseUrl, "transactions", "activity", PAGE_SIZE],
		initialPageParam: undefined as string | undefined,
		queryFn: ({ pageParam }) =>
			call(() =>
				api.v1.transactions.$get({
					query: { limit: String(PAGE_SIZE), ...(pageParam ? { cursor: pageParam } : {}) },
				}),
			),
		getNextPageParam: (last) => last.nextCursor ?? undefined,
	});
}
