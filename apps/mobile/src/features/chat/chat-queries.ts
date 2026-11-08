import {
	keepPreviousData,
	useInfiniteQuery,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { call } from "../../lib/api.ts";
import { useSession } from "../../lib/session.tsx";
import { PAGE_SIZE, RECENT_COUNT } from "./conversations-model.ts";

/*
 * Conversas (o histórico mora no servidor). Todas as chaves começam por `[baseUrl, "chat", "conversations"]`: o chat
 * invalida esse prefixo a cada mensagem e a tela "Conversas" a cada apagar ou renomear.
 */

/** As conversas mais recentes da gaveta: `limit=3` e o `nextCursor` diz se há mais ("Ver todas"). Só busca com a gaveta aberta. */
export function useRecentConversations(enabled: boolean) {
	const { api, baseUrl } = useSession();
	return useQuery({
		queryKey: [baseUrl, "chat", "conversations", "recent", RECENT_COUNT],
		enabled: enabled && Boolean(api && baseUrl),
		staleTime: 0,
		queryFn: () => {
			if (!api) throw new Error("Consulta sem sessão");
			return call(() => api.v1.chat.conversations.$get({ query: { limit: String(RECENT_COUNT) } }));
		},
	});
}

/** A lista completa em páginas (`cursor`), mais recente primeiro; `term` é a busca no título, feita no servidor. */
export function useConversationsList(term: string | undefined) {
	const { api, baseUrl } = useSession();
	return useInfiniteQuery({
		queryKey: [baseUrl, "chat", "conversations", "list", PAGE_SIZE, term ?? ""],
		enabled: Boolean(api && baseUrl),
		initialPageParam: undefined as string | undefined,
		// Ao digitar, a lista anterior fica na tela até a nova chegar (sem piscar).
		placeholderData: keepPreviousData,
		queryFn: ({ pageParam }) => {
			if (!api) throw new Error("Consulta sem sessão");
			return call(() =>
				api.v1.chat.conversations.$get({
					query: {
						limit: String(PAGE_SIZE),
						...(pageParam ? { cursor: pageParam } : {}),
						...(term ? { q: term } : {}),
					},
				}),
			);
		},
		getNextPageParam: (last) => last.nextCursor ?? undefined,
	});
}

function useRefreshConversations() {
	const { baseUrl } = useSession();
	const queryClient = useQueryClient();
	return () => queryClient.invalidateQueries({ queryKey: [baseUrl, "chat", "conversations"] });
}

export function useDeleteConversation() {
	const { api } = useSession();
	const refresh = useRefreshConversations();
	return useMutation({
		mutationFn: async (id: string) => {
			if (!api) throw new Error("Conversas sem sessão");
			await call(() => api.v1.chat.conversations[":id"].$delete({ param: { id } }));
		},
		onSuccess: () => void refresh(),
	});
}

export function useRenameConversation() {
	const { api } = useSession();
	const refresh = useRefreshConversations();
	return useMutation({
		mutationFn: async ({ id, title }: { id: string; title: string }) => {
			if (!api) throw new Error("Conversas sem sessão");
			await call(() => api.v1.chat.conversations[":id"].$patch({ param: { id }, json: { title } }));
		},
		onSuccess: () => void refresh(),
	});
}
