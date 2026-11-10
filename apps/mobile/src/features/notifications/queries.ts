import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { call } from "../../lib/api.ts";
import { useSession } from "../../lib/session.tsx";

/** Lista "Não entendi" das notificações de banco: o que o servidor guardou para o dono resolver. */
function useScoped() {
	const { api, baseUrl } = useSession();
	if (!api || !baseUrl) throw new Error("Consulta sem sessão");
	return { api, baseUrl };
}

export function useNotificationInbox() {
	const { api, baseUrl } = useScoped();
	return useQuery({
		queryKey: [baseUrl, "notification-inbox"],
		queryFn: async () => (await call(() => api.v1.notifications.inbox.$get())).items,
	});
}

/** Depois de mexer na lista, o contador das configurações e os lançamentos mudam também. */
function useRefreshAfter() {
	const { baseUrl } = useScoped();
	const queryClient = useQueryClient();
	return (alsoTransactions: boolean) => {
		void queryClient.invalidateQueries({ queryKey: [baseUrl, "notification-inbox"] });
		void queryClient.invalidateQueries({ queryKey: [baseUrl, "notification-settings"] });
		if (alsoTransactions) void queryClient.invalidateQueries({ queryKey: [baseUrl] });
	};
}

export function useRetryNotificationInbox() {
	const { api } = useScoped();
	const refresh = useRefreshAfter();
	return useMutation({
		mutationFn: async () => call(() => api.v1.notifications.inbox.retry.$post()),
		onSuccess: (result) => refresh(result.created > 0),
	});
}

export function useDismissNotification() {
	const { api } = useScoped();
	const refresh = useRefreshAfter();
	return useMutation({
		mutationFn: async (id: string) => {
			await call(() => api.v1.notifications.inbox[":id"].$delete({ param: { id } }));
		},
		onSuccess: () => refresh(false),
	});
}
