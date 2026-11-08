import { useQuery } from "@tanstack/react-query";
import { call } from "../../lib/api.ts";
import { useSession } from "../../lib/session.tsx";

/** Lista das últimas conversas (o histórico mora no servidor). Só busca quando a gaveta abre. */
export function useConversations(enabled: boolean) {
	const { api, baseUrl } = useSession();
	return useQuery({
		queryKey: [baseUrl, "chat", "conversations"],
		enabled: enabled && Boolean(api && baseUrl),
		staleTime: 0,
		queryFn: () => {
			if (!api) throw new Error("Consulta sem sessão");
			return call(() => api.v1.chat.conversations.$get());
		},
	});
}
