import { useQuery } from "@tanstack/react-query";
import { call } from "../../lib/api.ts";
import { useSession } from "../../lib/session.tsx";

/** Um lançamento (`GET /v1/transactions/:id`). A chave começa por `[baseUrl, "transactions"]`: sincronizar ou criar recarrega. */
export function useTransactionDetail(id: string) {
	const { api, baseUrl } = useSession();
	if (!api || !baseUrl) throw new Error("Consulta sem sessão");
	return useQuery({
		queryKey: [baseUrl, "transactions", "detail", id],
		queryFn: () => call(() => api.v1.transactions[":id"].$get({ param: { id } })),
	});
}
