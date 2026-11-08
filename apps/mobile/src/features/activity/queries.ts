import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { call } from "../../lib/api.ts";
import { useSession } from "../../lib/session.tsx";
import { PAGE_SIZE } from "./activity-model.ts";
import type { FilterParams } from "./filters-model.ts";

/**
 * Lançamentos em páginas (`GET /v1/transactions?cursor&limit&...filtros`, mais novo primeiro). Os filtros vão
 * para o servidor e entram na chave: mudar um filtro recomeça do topo, e o cursor sempre vale para o mesmo filtro.
 * A chave começa por `[baseUrl, "transactions"]`: entrar um lançamento novo ou terminar uma sincronização recarrega a lista.
 */
export function useActivityTransactions(filters: FilterParams) {
	const { api, baseUrl } = useSession();
	if (!api || !baseUrl) throw new Error("Consulta sem sessão");
	return useInfiniteQuery({
		queryKey: [baseUrl, "transactions", "activity", PAGE_SIZE, filters],
		initialPageParam: undefined as string | undefined,
		queryFn: ({ pageParam }) =>
			call(() =>
				api.v1.transactions.$get({
					query: { ...filters, limit: String(PAGE_SIZE), ...(pageParam ? { cursor: pageParam } : {}) },
				}),
			),
		getNextPageParam: (last) => last.nextCursor ?? undefined,
	});
}

/** Quantos lançamentos o filtro da gaveta acharia (`GET /v1/transactions/count`); o número anterior fica até chegar o novo. */
export function useFilterCount(filters: FilterParams, enabled: boolean) {
	const { api, baseUrl } = useSession();
	if (!api || !baseUrl) throw new Error("Consulta sem sessão");
	return useQuery({
		queryKey: [baseUrl, "transactions", "count", filters],
		enabled,
		placeholderData: keepPreviousData,
		queryFn: () => call(() => api.v1.transactions.count.$get({ query: filters })),
	});
}
