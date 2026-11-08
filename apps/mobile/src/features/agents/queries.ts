import type { AgentUpdateBody, CustomAgentCreateBody } from "@orbita/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { call } from "../../lib/api.ts";
import { useSession } from "../../lib/session.tsx";
import { isAffectedByAgents } from "./agents-model.ts";

function useScoped() {
	const { api, baseUrl } = useSession();
	if (!api || !baseUrl) throw new Error("Consulta sem sessão");
	return { api, baseUrl };
}

/** Os agentes (da casa e do dono), cada um com o resumo dos avisos. */
export function useAgents() {
	const { api, baseUrl } = useScoped();
	return useQuery({
		queryKey: [baseUrl, "agents"],
		queryFn: () => call(() => api.v1.agents.$get()),
	});
}

/** Um agente e os avisos recentes dele (os dispensados não vêm). */
export function useAgent(id: string | null) {
	const { api, baseUrl } = useScoped();
	return useQuery({
		queryKey: [baseUrl, "agents", id],
		enabled: id !== null,
		queryFn: () => call(() => api.v1.agents[":id"].$get({ param: { id: id ?? "" } })),
	});
}

function useRefreshAfter() {
	const { baseUrl } = useSession();
	const queryClient = useQueryClient();
	return () =>
		queryClient.invalidateQueries({
			predicate: (q) => baseUrl !== null && isAffectedByAgents(q.queryKey, baseUrl),
		});
}

export function useUpdateAgent() {
	const { api } = useSession();
	const refresh = useRefreshAfter();
	return useMutation({
		mutationFn: async (input: { id: string; body: AgentUpdateBody }) => {
			if (!api) throw new Error("Agente sem sessão");
			return await call(() => api.v1.agents[":id"].$patch({ param: { id: input.id }, json: input.body }));
		},
		onSuccess: () => {
			void refresh();
		},
	});
}

export function useCreateAgent() {
	const { api } = useSession();
	const refresh = useRefreshAfter();
	return useMutation({
		mutationFn: async (body: CustomAgentCreateBody) => {
			if (!api) throw new Error("Agente sem sessão");
			return await call(() => api.v1.agents.$post({ json: body }));
		},
		onSuccess: () => {
			void refresh();
		},
	});
}

export function useDeleteAgent() {
	const { api } = useSession();
	const refresh = useRefreshAfter();
	return useMutation({
		mutationFn: async (id: string) => {
			if (!api) throw new Error("Agente sem sessão");
			await call(() => api.v1.agents[":id"].$delete({ param: { id } }));
		},
		onSuccess: () => {
			void refresh();
		},
	});
}

/** "Visto" ou "Agora não" (dispensar) de um aviso. Dispensado some da tela do agente. */
export function useAnswerAlert() {
	const { api } = useSession();
	const refresh = useRefreshAfter();
	return useMutation({
		mutationFn: async (input: { id: string; action: "seen" | "dismiss" }) => {
			if (!api) throw new Error("Aviso sem sessão");
			const param = { id: input.id };
			return await call(() =>
				input.action === "seen"
					? api.v1.alerts[":id"].seen.$post({ param })
					: api.v1.alerts[":id"].dismiss.$post({ param }),
			);
		},
		onSuccess: () => {
			void refresh();
		},
	});
}
