import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rate-limit.ts";

function setup(opts: { limit?: number; windowMs?: number; maxKeys?: number } = {}) {
	let t = 1_000_000;
	const limiter = createRateLimiter({ limit: 3, windowMs: 60_000, ...opts, now: () => t });
	return { limiter, advance: (ms: number) => (t += ms) };
}

describe("rate limiter", () => {
	it("deixa passar até o limite e bloqueia o resto com retryAfter", () => {
		const { limiter, advance } = setup();
		for (let i = 0; i < 3; i++) expect(limiter.hit("a").allowed).toBe(true);
		advance(20_000);
		expect(limiter.hit("a")).toEqual({ allowed: false, retryAfterMs: 40_000 });
	});

	it("peek diz se o próximo hit passaria, sem contar", () => {
		const { limiter, advance } = setup({ limit: 2 });
		expect(limiter.peek("a").allowed).toBe(true);
		expect(limiter.size()).toBe(0);
		limiter.hit("a");
		expect(limiter.peek("a").allowed).toBe(true);
		limiter.hit("a");
		expect(limiter.peek("a")).toEqual({ allowed: false, retryAfterMs: 60_000 });
		expect(limiter.peek("a").allowed).toBe(false);
		advance(60_000);
		expect(limiter.peek("a").allowed).toBe(true);
	});

	it("separa as chaves", () => {
		const { limiter } = setup({ limit: 1 });
		expect(limiter.hit("a").allowed).toBe(true);
		expect(limiter.hit("b").allowed).toBe(true);
		expect(limiter.hit("a").allowed).toBe(false);
	});

	it("libera de novo quando a janela vence", () => {
		const { limiter, advance } = setup();
		for (let i = 0; i < 4; i++) limiter.hit("a");
		advance(60_000);
		expect(limiter.hit("a").allowed).toBe(true);
	});

	it("apaga chaves vencidas", () => {
		const { limiter, advance } = setup();
		limiter.hit("a");
		limiter.hit("b");
		advance(61_000);
		limiter.hit("c");
		expect(limiter.size()).toBe(1);
	});

	it("respeita o teto de chaves, tirando as mais antigas", () => {
		const { limiter } = setup({ limit: 1, maxKeys: 3 });
		for (const k of ["a", "b", "c", "d"]) limiter.hit(k);
		expect(limiter.size()).toBe(3);
		// "a" foi despejada, então volta a ser permitida; "d" continua contada.
		expect(limiter.hit("d").allowed).toBe(false);
		expect(limiter.hit("a").allowed).toBe(true);
	});
});
