import { useQueryClient } from "@tanstack/react-query";
import { call } from "../../lib/api.ts";
import { useSession } from "../../lib/session.tsx";
import { createSecretActions, type SecretActions } from "./secret-requests.ts";

export function useSecretActions(): SecretActions {
	const { api, baseUrl, handleQueryError } = useSession();
	const queryClient = useQueryClient();
	return createSecretActions({
		put: (name, value) => {
			if (!api) throw new Error("Sem sessão");
			return call(() => api.v1.settings.secrets[":name"].$put({ param: { name }, json: { value } }));
		},
		del: (name) => {
			if (!api) throw new Error("Sem sessão");
			return call(() => api.v1.settings.secrets[":name"].$delete({ param: { name } }));
		},
		onError: handleQueryError,
		refresh: () => queryClient.invalidateQueries({ queryKey: [baseUrl, "settings", "secrets"] }),
	});
}
