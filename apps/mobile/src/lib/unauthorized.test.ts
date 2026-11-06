import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./api.ts";
import { createUnauthorizedGuard, isUnauthorized } from "./unauthorized.ts";

describe("401", () => {
	it("só ApiError 401 conta", () => {
		expect(isUnauthorized(new ApiError("x", 401, "nao_autorizado"))).toBe(true);
		expect(isUnauthorized(new ApiError("x", 500, "erro"))).toBe(false);
		expect(isUnauthorized(new ApiError("x", null, "sem_conexao"))).toBe(false);
		expect(isUnauthorized(new Error("x"))).toBe(false);
	});
	it("dispara uma vez para vários 401 e rearma com reset", () => {
		const onUnauthorized = vi.fn();
		const guard = createUnauthorizedGuard(onUnauthorized);
		const err = new ApiError("x", 401, "nao_autorizado");
		guard.handle(err);
		guard.handle(err);
		guard.handle(new ApiError("x", 500, "erro"));
		expect(onUnauthorized).toHaveBeenCalledTimes(1);
		guard.reset();
		guard.handle(err);
		expect(onUnauthorized).toHaveBeenCalledTimes(2);
	});
});
