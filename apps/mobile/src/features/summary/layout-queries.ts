import { type HomeLayout, homeLayoutResponse } from "@orbita/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { call } from "../../lib/api.ts";
import { useSession } from "../../lib/session.tsx";

/** Layout dos widgets do Início: guardado no servidor, então o mesmo em todos os aparelhos do dono. */
function useScoped() {
	const { api, baseUrl } = useSession();
	if (!api || !baseUrl) throw new Error("Consulta sem sessão");
	return { api, baseUrl };
}

export function useHomeLayout() {
	const { api, baseUrl } = useScoped();
	return useQuery({
		queryKey: [baseUrl, "home-layout"],
		queryFn: async () => homeLayoutResponse.parse(await call(() => api.v1.home.layout.$get())).items,
	});
}

/** Salva o layout inteiro. A tela já mostra o novo na hora; se o servidor recusar, volta ao que estava. */
export function useSaveHomeLayout() {
	const { api, baseUrl } = useScoped();
	const queryClient = useQueryClient();
	const key = [baseUrl, "home-layout"];
	return useMutation({
		mutationFn: async (items: HomeLayout) =>
			homeLayoutResponse.parse(await call(() => api.v1.home.layout.$put({ json: { items } }))).items,
		onMutate: async (items) => {
			await queryClient.cancelQueries({ queryKey: key });
			const previous = queryClient.getQueryData<HomeLayout>(key);
			queryClient.setQueryData(key, items);
			return { previous };
		},
		onError: (_error, _items, context) => {
			if (context?.previous) queryClient.setQueryData(key, context.previous);
		},
		onSuccess: (items) => queryClient.setQueryData(key, items),
	});
}
