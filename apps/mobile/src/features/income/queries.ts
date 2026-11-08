import type { BudgetBefore } from "@orbita/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, call, UNREACHABLE_MESSAGE } from "../../lib/api.ts";
import { useSession } from "../../lib/session.tsx";
import { type IncomeRequest, isAffectedByIncome } from "./income-model.ts";

function useScoped() {
	const { api, baseUrl } = useSession();
	if (!api || !baseUrl) throw new Error("Consulta sem sessão");
	return { api, baseUrl };
}

/** As rendas ativas, o que entra neste mês e o próximo pagamento (tudo do servidor). */
export function useIncome() {
	const { api, baseUrl } = useScoped();
	return useQuery({ queryKey: [baseUrl, "income"], queryFn: () => call(() => api.v1.income.$get()) });
}

/** O plano do mês, do engine. `reservePercent` ausente = o padrão do servidor. */
export function usePlan(month: string, reservePercent: number | undefined) {
	const { api, baseUrl } = useScoped();
	return useQuery({
		queryKey: [baseUrl, "plan", month, reservePercent ?? null],
		queryFn: () =>
			call(() =>
				api.v1.plan[":month"].$get({
					param: { month },
					query: reservePercent === undefined ? {} : { reservePercent: String(reservePercent) },
				}),
			),
	});
}

/** Renda, plano, orçamento e resumo mudam juntos. */
function useRefreshAfter() {
	const { baseUrl } = useSession();
	const queryClient = useQueryClient();
	return () =>
		queryClient.invalidateQueries({
			predicate: (q) => baseUrl !== null && isAffectedByIncome(q.queryKey, baseUrl),
		});
}

export function useSaveIncome() {
	const { api } = useSession();
	const refresh = useRefreshAfter();
	return useMutation({
		mutationFn: async (request: IncomeRequest) => {
			if (!api) throw new Error("Renda sem sessão");
			if (request.type === "create") {
				return (await call(() => api.v1.income.$post({ json: request.body }))).source;
			}
			return (
				await call(() => api.v1.income[":id"].$patch({ param: { id: request.id }, json: request.body }))
			).source;
		},
		onSuccess: () => {
			void refresh();
		},
	});
}

export function useArchiveIncome() {
	const { api } = useSession();
	const refresh = useRefreshAfter();
	return useMutation({
		mutationFn: async (id: string) => {
			if (!api) throw new Error("Renda sem sessão");
			await call(() => api.v1.income[":id"].$delete({ param: { id } }));
		},
		onSuccess: () => {
			void refresh();
		},
	});
}

/** "Aplicar ao orçamento": grava o plano; `confirm` autoriza trocar limites que o dono já definiu. */
export function useApplyPlan() {
	const { api } = useSession();
	const refresh = useRefreshAfter();
	return useMutation({
		mutationFn: async (input: { month: string; reservePercent: number | undefined; confirm: boolean }) => {
			if (!api) throw new Error("Plano sem sessão");
			return await call(() =>
				api.v1.plan[":month"].apply.$post({
					param: { month: input.month },
					json: {
						confirm: input.confirm,
						...(input.reservePercent === undefined ? {} : { reservePercent: input.reservePercent }),
					},
				}),
			);
		},
		onSettled: () => {
			void refresh();
		},
	});
}

/** "Ajustar para caber": o servidor reduz os limites das categorias até caberem no total. */
export function useFitBudgets() {
	const { api } = useSession();
	const refresh = useRefreshAfter();
	return useMutation({
		mutationFn: async () => {
			if (!api) throw new Error("Orçamento sem sessão");
			return await call(() => api.v1.budgets.fit.$post());
		},
		onSettled: () => {
			void refresh();
		},
	});
}

/** Desfazer: devolve os limites ao que eram. O servidor responde 204, sem corpo. */
export function useRestoreBudgets() {
	const { api } = useSession();
	const refresh = useRefreshAfter();
	return useMutation({
		mutationFn: async (previous: readonly BudgetBefore[]) => {
			if (!api) throw new Error("Orçamento sem sessão");
			let res: Awaited<ReturnType<typeof api.v1.budgets.restore.$post>>;
			try {
				res = await api.v1.budgets.restore.$post({ json: { previous: [...previous] } });
			} catch {
				throw new ApiError(UNREACHABLE_MESSAGE, null, "sem_conexao");
			}
			if (!res.ok) await call(async () => res);
		},
		onSettled: () => {
			void refresh();
		},
	});
}
