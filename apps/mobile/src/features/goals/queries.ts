import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { call } from "../../lib/api.ts";
import { useSession } from "../../lib/session.tsx";
import { isAffectedByGoals, type SaveRequest } from "./goals-model.ts";

function useScoped() {
	const { api, baseUrl } = useSession();
	if (!api || !baseUrl) throw new Error("Consulta sem sessão");
	return { api, baseUrl };
}

/** As metas ativas, já com os números do engine, e o total guardado. */
export function useGoals() {
	const { api, baseUrl } = useScoped();
	return useQuery({
		queryKey: [baseUrl, "goals"],
		queryFn: () => call(() => api.v1.goals.$get()),
	});
}

/** Uma meta (também arquivada) e as contribuições, da mais recente para a mais antiga. */
export function useGoal(id: string | null) {
	const { api, baseUrl } = useScoped();
	return useQuery({
		queryKey: [baseUrl, "goals", id],
		enabled: id !== null,
		queryFn: () => call(() => api.v1.goals[":id"].$get({ param: { id: id ?? "" } })),
	});
}

/** Depois de qualquer mudança, a lista, o detalhe e a sobra escolhida nas preferências recarregam. */
function useRefreshAfter() {
	const { baseUrl } = useSession();
	const queryClient = useQueryClient();
	return () =>
		queryClient.invalidateQueries({
			predicate: (q) => baseUrl !== null && isAffectedByGoals(q.queryKey, baseUrl),
		});
}

export function useSaveGoal() {
	const { api } = useSession();
	const refresh = useRefreshAfter();
	return useMutation({
		mutationFn: async (request: SaveRequest) => {
			if (!api) throw new Error("Meta sem sessão");
			if (request.type === "create") {
				return (await call(() => api.v1.goals.$post({ json: request.body }))).goal;
			}
			return (await call(() => api.v1.goals[":id"].$patch({ param: { id: request.id }, json: request.body })))
				.goal;
		},
		onSuccess: () => {
			void refresh();
		},
	});
}

export function useArchiveGoal() {
	const { api } = useSession();
	const refresh = useRefreshAfter();
	return useMutation({
		mutationFn: async (id: string) => {
			if (!api) throw new Error("Meta sem sessão");
			await call(() => api.v1.goals[":id"].$delete({ param: { id } }));
		},
		onSuccess: () => {
			void refresh();
		},
	});
}

/** "Guardar": só registra o valor na meta; o servidor não move dinheiro de conta nenhuma. */
export function useAddContribution() {
	const { api } = useSession();
	const refresh = useRefreshAfter();
	return useMutation({
		mutationFn: async (input: { id: string; amountCents: number }) => {
			if (!api) throw new Error("Meta sem sessão");
			return await call(() =>
				api.v1.goals[":id"].contributions.$post({
					param: { id: input.id },
					json: { amountCents: input.amountCents },
				}),
			);
		},
		onSuccess: () => {
			void refresh();
		},
	});
}

export function useRemoveContribution() {
	const { api } = useSession();
	const refresh = useRefreshAfter();
	return useMutation({
		mutationFn: async (input: { id: string; contributionId: string }) => {
			if (!api) throw new Error("Meta sem sessão");
			await call(() =>
				api.v1.goals[":id"].contributions[":contributionId"].$delete({
					param: { id: input.id, contributionId: input.contributionId },
				}),
			);
		},
		onSuccess: () => {
			void refresh();
		},
	});
}
