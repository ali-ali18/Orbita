import type { InvestmentEvolutionRange } from "@orbita/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { call } from "../../lib/api.ts";
import { useSession } from "../../lib/session.tsx";
import { isInvestmentsKey, type TermsPutBody } from "./terms-model.ts";

/** Consultas de Investimentos (só leitura). A chave inclui o servidor: trocar de servidor não reaproveita dados. */
function useScoped() {
	const { api, baseUrl } = useSession();
	if (!api || !baseUrl) throw new Error("Consulta sem sessão");
	return { api, baseUrl };
}

export function useInvestments() {
	const { api, baseUrl } = useScoped();
	return useQuery({
		queryKey: [baseUrl, "investments"],
		queryFn: () => call(() => api.v1.investments.$get()),
	});
}

export function useInvestmentEvolution(range: InvestmentEvolutionRange) {
	const { api, baseUrl } = useScoped();
	return useQuery({
		queryKey: [baseUrl, "investments-evolution", range],
		queryFn: () => call(() => api.v1.investments.evolution.$get({ query: { range } })),
	});
}

export function useInvestmentDetail(id: string | undefined) {
	const { api, baseUrl } = useScoped();
	return useQuery({
		queryKey: [baseUrl, "investment", id],
		enabled: Boolean(id),
		queryFn: () => call(() => api.v1.investments[":id"].$get({ param: { id: id ?? "" } })),
	});
}

/** Grava o que o dono informou (substitui tudo) e recarrega lista, detalhe e evolução com os números recalculados. */
export function useSaveTerms(id: string) {
	const { api, baseUrl } = useSession();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (body: TermsPutBody) => {
			if (!api) throw new Error("Sem sessão");
			// A rota lê o corpo cru (sem validador tipado): o JSON vai por `init`.
			return await call(() =>
				api.v1.investments[":id"].terms.$put(
					{ param: { id } },
					{ headers: { "content-type": "application/json" }, init: { body: JSON.stringify(body) } },
				),
			);
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				predicate: (q) => baseUrl !== null && isInvestmentsKey(q.queryKey, baseUrl),
			});
		},
	});
}
