import type { NotificationSettingsPatchBody, PreferencesPatchBody, ProfilePatchBody } from "@orbita/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { call } from "../../lib/api.ts";
import { useSession } from "../../lib/session.tsx";

/** Perfil, preferências e notificações do celular: configuração guardada no servidor. A chave inclui o servidor. */
function useScoped() {
	const { api, baseUrl } = useSession();
	if (!api || !baseUrl) throw new Error("Consulta sem sessão");
	return { api, baseUrl };
}

export function useProfile() {
	const { api, baseUrl } = useScoped();
	return useQuery({
		queryKey: [baseUrl, "profile"],
		queryFn: async () => (await call(() => api.v1.profile.$get())).profile,
	});
}

export function useUpdateProfile() {
	const { api, baseUrl } = useScoped();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (patch: ProfilePatchBody) =>
			(await call(() => api.v1.profile.$patch({ json: patch }))).profile,
		onSuccess: (profile) => {
			queryClient.setQueryData([baseUrl, "profile"], profile);
			// O nome do aparelho também aparece em "Servidor e chaves".
			void queryClient.invalidateQueries({ queryKey: [baseUrl, "settings", "server"] });
		},
	});
}

export function usePreferences() {
	const { api, baseUrl } = useScoped();
	return useQuery({
		queryKey: [baseUrl, "preferences"],
		queryFn: async () => (await call(() => api.v1.preferences.$get())).preferences,
	});
}

export function useUpdatePreferences() {
	const { api, baseUrl } = useScoped();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (patch: PreferencesPatchBody) =>
			(await call(() => api.v1.preferences.$patch({ json: patch }))).preferences,
		onSuccess: (preferences) => {
			queryClient.setQueryData([baseUrl, "preferences"], preferences);
			// O percentual do aviso muda quais limites aparecem como "passou de X%" no resumo.
			void queryClient.invalidateQueries({ queryKey: [baseUrl, "summary"] });
		},
	});
}

export function useNotificationSettings() {
	const { api, baseUrl } = useScoped();
	return useQuery({
		queryKey: [baseUrl, "notification-settings"],
		queryFn: async () => (await call(() => api.v1["notification-settings"].$get())).notifications,
	});
}

export function useUpdateNotificationSettings() {
	const { api, baseUrl } = useScoped();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (patch: NotificationSettingsPatchBody) =>
			(await call(() => api.v1["notification-settings"].$patch({ json: patch }))).notifications,
		onSuccess: (notifications) => queryClient.setQueryData([baseUrl, "notification-settings"], notifications),
	});
}
