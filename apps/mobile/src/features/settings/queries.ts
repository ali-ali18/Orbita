import { useQuery } from "@tanstack/react-query";
import { call } from "../../lib/api.ts";
import { useSession } from "../../lib/session.tsx";
import { timed } from "./settings-model.ts";

function useScoped() {
	const { api, baseUrl } = useSession();
	if (!api || !baseUrl) throw new Error("Consulta sem sessão");
	return { api, baseUrl };
}

/** Só o estado das chaves (nome, configurada, quando mudou). O valor nunca vem do servidor. */
export function useSecrets() {
	const { api, baseUrl } = useScoped();
	return useQuery({
		queryKey: [baseUrl, "settings", "secrets"],
		queryFn: () => call(() => api.v1.settings.secrets.$get()),
	});
}

/** Versão do servidor, o aparelho e quanto a resposta demorou (medido aqui, com `performance.now`). */
export function useServerInfo() {
	const { api, baseUrl } = useScoped();
	return useQuery({
		queryKey: [baseUrl, "settings", "server"],
		// Testar a conexão tem de falar com o servidor de verdade, sem cache nem retentativa.
		staleTime: 0,
		retry: false,
		queryFn: async () => {
			const { result, ms } = await timed(
				() => call(() => api.v1.server.$get()),
				() => performance.now(),
			);
			return { ...result, ms };
		},
	});
}
