import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api.ts";
import { createUnauthorizedGuard } from "../../lib/unauthorized.ts";
import { createSecretActions } from "./secret-requests.ts";

const VALUE = "sk-ant-teste-0000111122223333aaaa";

describe("ações de chave", () => {
	it("grava e recarrega só o estado das chaves; nenhum cache guarda o valor", async () => {
		const queryClient = new QueryClient();
		queryClient.setQueryData(["srv", "settings", "secrets"], { secrets: [] });
		const put = vi.fn(async () => ({ secret: { name: "anthropic_api_key", configured: true } }));
		const actions = createSecretActions({
			put,
			del: async () => {},
			onError: () => {},
			refresh: () => queryClient.invalidateQueries({ queryKey: ["srv", "settings", "secrets"] }),
		});

		await actions.save("anthropic_api_key", VALUE);

		expect(put).toHaveBeenCalledWith("anthropic_api_key", VALUE);
		const dump = JSON.stringify({
			queries: queryClient
				.getQueryCache()
				.getAll()
				.map((q) => ({ key: q.queryKey, state: q.state })),
			mutations: queryClient
				.getMutationCache()
				.getAll()
				.map((m) => ({ key: m.options.mutationKey, state: m.state })),
		});
		expect(dump).not.toContain(VALUE);
		expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
	});

	it("401 ao salvar passa pelo tratamento de sessão (uma vez só) e o erro continua subindo", async () => {
		const onUnauthorized = vi.fn();
		const guard = createUnauthorizedGuard(onUnauthorized);
		const unauthorized = new ApiError("Sessão inválida.", 401, "nao_autorizado");
		const actions = createSecretActions({
			put: async () => {
				throw unauthorized;
			},
			del: async () => {
				throw unauthorized;
			},
			onError: (e) => guard.handle(e),
			refresh: async () => {},
		});

		await expect(actions.save("anthropic_api_key", VALUE)).rejects.toBe(unauthorized);
		await expect(actions.remove("anthropic_api_key")).rejects.toBe(unauthorized);
		expect(onUnauthorized).toHaveBeenCalledTimes(1);
	});

	it("erro que não é 401 não encerra a sessão", async () => {
		const onUnauthorized = vi.fn();
		const guard = createUnauthorizedGuard(onUnauthorized);
		const actions = createSecretActions({
			put: async () => {
				throw new ApiError("Falhou.", 500, "x");
			},
			del: async () => {},
			onError: (e) => guard.handle(e),
			refresh: async () => {},
		});
		await expect(actions.save("anthropic_api_key", VALUE)).rejects.toThrow("Falhou.");
		expect(onUnauthorized).not.toHaveBeenCalled();
	});

	it("falha não recarrega a lista", async () => {
		const refresh = vi.fn(async () => {});
		const actions = createSecretActions({
			put: async () => {
				throw new Error("x");
			},
			del: async () => {},
			onError: () => {},
			refresh,
		});
		await actions.save("anthropic_api_key", VALUE).catch(() => {});
		expect(refresh).not.toHaveBeenCalled();
	});
});
