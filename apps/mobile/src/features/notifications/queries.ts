import type { NotificationApp } from "@orbita/shared";
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

/** O dono escolhe o cartão de uma compra da lista: lança e o app lembra o final. */
export function useChooseNotificationCard() {
	const { api } = useScoped();
	const refresh = useRefreshAfter();
	return useMutation({
		mutationFn: async (input: { id: string; cardId: string }) =>
			call(() =>
				api.v1.notifications.inbox[":id"].card.$post({
					param: { id: input.id },
					json: { cardId: input.cardId },
				}),
			),
		onSuccess: () => refresh(true),
	});
}

/** Finais de cartão virtual ligados a um cartão (o app lembra; o dono pode esquecer). */
export function useNotificationCardLinks() {
	const { api, baseUrl } = useScoped();
	return useQuery({
		queryKey: [baseUrl, "notification-card-links"],
		queryFn: async () => (await call(() => api.v1.notifications["card-links"].$get())).links,
	});
}

export function useForgetCardLink() {
	const { api, baseUrl } = useScoped();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (link: { app: NotificationApp; last4: string }) => {
			await call(() => api.v1.notifications["card-links"][":app"][":last4"].$delete({ param: link }));
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: [baseUrl, "notification-card-links"] });
		},
	});
}

/** "É compra": a oferta oculta volta à lista como "Não entendi o formato". */
export function useKeepOfferAsPurchase() {
	const { api } = useScoped();
	const refresh = useRefreshAfter();
	return useMutation({
		mutationFn: async (id: string) => {
			await call(() => api.v1.notifications.inbox[":id"].purchase.$post({ param: { id } }));
		},
		onSuccess: () => refresh(false),
	});
}
