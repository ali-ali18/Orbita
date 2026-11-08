import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { call } from "../../lib/api.ts";
import { useSession } from "../../lib/session.tsx";

/** Gasto do mês com a IA e o limite (o servidor calcula; o app só mostra). */
export function useAiSettings() {
	const { api, baseUrl } = useSession();
	return useQuery({
		queryKey: [baseUrl, "settings", "ai"],
		enabled: Boolean(api && baseUrl),
		queryFn: () => {
			if (!api) throw new Error("Consulta sem sessão");
			return call(() => api.v1.settings.ai.$get());
		},
	});
}

/** Troca o limite mensal; `null` tira o limite. */
export function useSaveAiLimit() {
	const { api, baseUrl, handleQueryError } = useSession();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (monthlyLimitUsdCents: number | null) => {
			if (!api) throw new Error("Sem sessão");
			return call(() => api.v1.settings.ai.$put({ json: { monthlyLimitUsdCents } }));
		},
		onSuccess: (data) => {
			queryClient.setQueryData([baseUrl, "settings", "ai"], data);
		},
		onError: handleQueryError,
	});
}

/** Troca o modelo do chat e/ou o rápido; `null` volta ao padrão do servidor, "off" desliga o rápido. */
export function useSaveAiModels() {
	const { api, baseUrl, handleQueryError } = useSession();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (json: { chatModel?: string | null; chatModelFast?: string | null }) => {
			if (!api) throw new Error("Sem sessão");
			return call(() => api.v1.settings.ai.$put({ json }));
		},
		onSuccess: (data) => {
			queryClient.setQueryData([baseUrl, "settings", "ai"], data);
		},
		onError: handleQueryError,
	});
}
