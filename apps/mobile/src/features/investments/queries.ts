import type { InvestmentEvolutionRange } from "@orbita/shared";
import { useQuery } from "@tanstack/react-query";
import { call } from "../../lib/api.ts";
import { useSession } from "../../lib/session.tsx";

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
