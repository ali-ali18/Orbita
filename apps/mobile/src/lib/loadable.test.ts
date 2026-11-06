import { describe, expect, it, vi } from "vitest";
import { ApiError, UNREACHABLE_MESSAGE } from "./api.ts";
import { combineLoadables, type QueryLike, toLoadable } from "./loadable.ts";

const base = {
	data: undefined,
	error: null,
	isPending: true,
	isError: false,
	fetchStatus: "fetching",
	refetch: () => {},
} as const;
const q = <T>(over: Partial<QueryLike<T>>): QueryLike<T> => ({ ...base, ...over }) as QueryLike<T>;

describe("toLoadable", () => {
	it("carregando enquanto busca", () => {
		expect(toLoadable(q({}))).toEqual({ phase: "loading" });
	});
	it("erro mostra a mensagem da API e o retry refaz a consulta", () => {
		const refetch = vi.fn();
		const r = toLoadable(
			q({ isError: true, isPending: false, error: new ApiError("Falhou feio.", 500, "x"), refetch }),
		);
		expect(r).toMatchObject({ phase: "error", message: "Falhou feio." });
		if (r.phase === "error") r.retry();
		expect(refetch).toHaveBeenCalledTimes(1);
	});
	it("pausada (sem rede) é erro, nunca carregando eterno", () => {
		expect(toLoadable(q({ fetchStatus: "paused" }))).toMatchObject({
			phase: "error",
			message: UNREACHABLE_MESSAGE,
		});
	});
	it("com dado, mostra mesmo se a atualização falhou", () => {
		expect(toLoadable(q({ data: 1, isPending: false, isError: true, error: new Error("x") }))).toEqual({
			phase: "ready",
			data: 1,
		});
	});
	it("lista vazia é pronto, não carregando", () => {
		expect(toLoadable(q<number[]>({ data: [], isPending: false }))).toEqual({ phase: "ready", data: [] });
	});
});

describe("combineLoadables", () => {
	const ready = <T>(data: T) => ({ phase: "ready", data }) as const;
	const loading = { phase: "loading" } as const;
	it("pronto quando os dois estão prontos", () => {
		expect(combineLoadables(ready(1), ready("a"))).toEqual({ phase: "ready", data: [1, "a"] });
	});
	it("carregando se algum carrega", () => {
		expect(combineLoadables(ready(1), loading)).toEqual({ phase: "loading" });
	});
	it("erro vence carregando e o retry refaz os que falharam", () => {
		const retryA = vi.fn();
		const retryB = vi.fn();
		const r = combineLoadables(
			{ phase: "error", message: "A", retry: retryA },
			{ phase: "error", message: "B", retry: retryB },
		);
		expect(r).toMatchObject({ phase: "error", message: "A" });
		if (r.phase === "error") r.retry();
		expect(retryA).toHaveBeenCalled();
		expect(retryB).toHaveBeenCalled();
		expect(combineLoadables(loading, { phase: "error", message: "B", retry: retryB })).toMatchObject({
			phase: "error",
			message: "B",
		});
	});
});
