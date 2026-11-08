import { useQuery } from "@tanstack/react-query";
import { call } from "../../lib/api.ts";
import { useSession } from "../../lib/session.tsx";

function useScoped() {
	const { api, baseUrl } = useSession();
	if (!api || !baseUrl) throw new Error("Consulta sem sessão");
	return { api, baseUrl };
}

/** Meses que têm lançamento (do mais recente ao mais antigo). */
export function useReportMonths() {
	const { api, baseUrl } = useScoped();
	return useQuery({
		queryKey: [baseUrl, "reports"],
		queryFn: () => call(() => api.v1.reports.$get()),
	});
}

/** O relatório do mês, calculado pelo engine no servidor. */
export function useReport(month: string | null) {
	const { api, baseUrl } = useScoped();
	return useQuery({
		queryKey: [baseUrl, "reports", month],
		enabled: month !== null,
		queryFn: () => call(() => api.v1.reports[":month"].$get({ param: { month: month ?? "" } })),
	});
}
