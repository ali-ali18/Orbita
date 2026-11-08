import { describe, expect, it } from "vitest";
import { ApiError } from "../../lib/api.ts";
import {
	isUnreachableError,
	isUnreachableQuery,
	lastContactAt,
	serverDownCaption,
	serverHost,
} from "./server-model.ts";

const NOW = new Date("2026-11-08T12:00:00.000Z");
const query = (over: object) => ({
	data: undefined,
	error: null,
	isError: false,
	isPending: true,
	fetchStatus: "fetching" as const,
	...over,
});

describe("isUnreachableError", () => {
	it("rede e tempo esgotado são servidor fora do ar", () => {
		expect(isUnreachableError(new ApiError("x", null, "sem_conexao"))).toBe(true);
	});
	it("proxy sem backend (502, 503, 504) também", () => {
		for (const status of [502, 503, 504]) {
			expect(isUnreachableError(new ApiError("x", status, "resposta_invalida"))).toBe(true);
		}
	});
	it("4xx e 500 da API não são", () => {
		for (const status of [400, 401, 403, 404, 409, 422, 429, 500]) {
			expect(isUnreachableError(new ApiError("x", status, "erro"))).toBe(false);
		}
	});
	it("erro que não é da API não é", () => {
		expect(isUnreachableError(new Error("boom"))).toBe(false);
		expect(isUnreachableError(null)).toBe(false);
	});
});

describe("isUnreachableQuery", () => {
	it("erro de rede sem dado", () => {
		expect(
			isUnreachableQuery(
				query({ isError: true, isPending: false, error: new ApiError("x", null, "sem_conexao") }),
			),
		).toBe(true);
	});
	it("pausada sem rede e sem dado", () => {
		expect(isUnreachableQuery(query({ fetchStatus: "paused" }))).toBe(true);
	});
	it("com dado em cache não troca a tela", () => {
		expect(
			isUnreachableQuery(
				query({ data: {}, isError: true, isPending: false, error: new ApiError("x", null, "sem_conexao") }),
			),
		).toBe(false);
	});
	it("carregando e erro 4xx não são", () => {
		expect(isUnreachableQuery(query({}))).toBe(false);
		expect(
			isUnreachableQuery(query({ isError: true, isPending: false, error: new ApiError("x", 403, "erro") })),
		).toBe(false);
	});
});

describe("lastContactAt", () => {
	it("pega o mais recente entre os que têm dado", () => {
		expect(
			lastContactAt([
				{ dataUpdatedAt: 100, hasData: true },
				{ dataUpdatedAt: 300, hasData: true },
				{ dataUpdatedAt: 900, hasData: false },
			]),
		).toBe(300);
	});
	it("nenhum dado: null", () => {
		expect(lastContactAt([])).toBeNull();
		expect(lastContactAt([{ dataUpdatedAt: 0, hasData: true }])).toBeNull();
	});
});

describe("serverHost e serverDownCaption", () => {
	it("tira o protocolo", () => {
		expect(serverHost("https://financas.exemplo.dev/")).toBe("financas.exemplo.dev");
		expect(serverHost(null)).toBeNull();
	});
	it("junta último contato e endereço", () => {
		const at = NOW.getTime() - 12 * 60_000;
		expect(serverDownCaption(at, "https://financas.exemplo.dev", NOW)).toBe(
			"Último contato há 12 min · financas.exemplo.dev",
		);
	});
	it("sem contato guardado, só o endereço", () => {
		expect(serverDownCaption(null, "https://financas.exemplo.dev", NOW)).toBe("financas.exemplo.dev");
		expect(serverDownCaption(null, null, NOW)).toBe("");
	});
});
