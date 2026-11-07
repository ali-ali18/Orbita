import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./api.ts";

// `shouldRetry` mora no mesmo arquivo do cliente; o react-native não carrega em Node.
vi.mock("react-native", () => ({ AppState: { addEventListener: () => ({ remove() {} }) } }));
const { shouldRetry, createAppQueryClient } = await import("./query-client.ts");

describe("shouldRetry", () => {
	it("erro HTTP não repete", () => {
		expect(shouldRetry(0, new ApiError("x", 500, "erro"))).toBe(false);
		expect(shouldRetry(0, new ApiError("x", 401, "erro"))).toBe(false);
	});
	it("rede fora do ar repete até 2 vezes", () => {
		const net = new ApiError("x", null, "sem_conexao");
		expect(shouldRetry(0, net)).toBe(true);
		expect(shouldRetry(1, net)).toBe(true);
		expect(shouldRetry(2, net)).toBe(false);
	});
});

describe("createAppQueryClient", () => {
	it("erro ao salvar também chega no onError (sai da sessão no 401)", async () => {
		const onError = vi.fn();
		const client = createAppQueryClient(onError);
		const error = new ApiError("x", 401, "Sessão expirada");
		await expect(
			client
				.getMutationCache()
				.build(client, { mutationFn: () => Promise.reject(error) })
				.execute(undefined),
		).rejects.toBe(error);
		expect(onError).toHaveBeenCalledWith(error, undefined, undefined, expect.anything(), expect.anything());
	});
});
