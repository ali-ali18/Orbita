import type { CategoryCreateBody, CategoryUpdateBody } from "@orbita/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { call } from "../../lib/api.ts";
import { useSession } from "../../lib/session.tsx";
import { isAffectedByCategories } from "./categories-model.ts";

export { useCategories } from "../summary/queries.ts";

export function useCategoryRules() {
	const { api, baseUrl } = useSession();
	if (!api || !baseUrl) throw new Error("Consulta sem sessão");
	return useQuery({
		queryKey: [baseUrl, "category-rules"],
		queryFn: () => call(() => api.v1["category-rules"].$get()),
	});
}

function useRefreshAfter() {
	const { baseUrl } = useSession();
	const queryClient = useQueryClient();
	return () =>
		queryClient.invalidateQueries({
			predicate: (q) => baseUrl !== null && isAffectedByCategories(q.queryKey, baseUrl),
		});
}

export function useCreateCategory() {
	const { api } = useSession();
	const refresh = useRefreshAfter();
	return useMutation({
		mutationFn: async (body: CategoryCreateBody) => {
			if (!api) throw new Error("Categorias sem sessão");
			await call(() => api.v1.categories.$post({ json: body }));
		},
		onSuccess: () => void refresh(),
	});
}

export function useUpdateCategory() {
	const { api } = useSession();
	const refresh = useRefreshAfter();
	return useMutation({
		mutationFn: async ({ id, body }: { id: string; body: CategoryUpdateBody }) => {
			if (!api) throw new Error("Categorias sem sessão");
			await call(() => api.v1.categories[":id"].$patch({ param: { id }, json: body }));
		},
		onSuccess: () => void refresh(),
	});
}

/** A API arquiva: a categoria some das listas e os lançamentos antigos continuam com ela. */
export function useArchiveCategory() {
	const { api } = useSession();
	const refresh = useRefreshAfter();
	return useMutation({
		mutationFn: async (id: string) => {
			if (!api) throw new Error("Categorias sem sessão");
			await call(() => api.v1.categories[":id"].$delete({ param: { id } }));
		},
		onSuccess: () => void refresh(),
	});
}

export function useDeleteRule() {
	const { api } = useSession();
	const refresh = useRefreshAfter();
	return useMutation({
		mutationFn: async (id: string) => {
			if (!api) throw new Error("Regras sem sessão");
			await call(() => api.v1["category-rules"][":id"].$delete({ param: { id } }));
		},
		onSuccess: () => void refresh(),
	});
}
