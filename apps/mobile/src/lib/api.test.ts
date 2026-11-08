import { afterEach, describe, expect, it, vi } from "vitest";
import { withTimeout } from "./api.ts";

afterEach(() => vi.useRealTimers());

describe("withTimeout", () => {
	it("devolve a resposta quando chega a tempo", async () => {
		const res = new Response("{}");
		const fetchImpl = vi.fn().mockResolvedValue(res);
		await expect(withTimeout(fetchImpl, 1000)("http://x")).resolves.toBe(res);
	});

	it("aborta depois do prazo", async () => {
		vi.useFakeTimers();
		const fetchImpl = vi.fn(
			(_input: RequestInfo | URL, init?: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () => reject(new Error("abortado")));
				}),
		);
		const pending = withTimeout(fetchImpl, 1000)("http://x");
		const caught = pending.catch((e: unknown) => e);
		await vi.advanceTimersByTimeAsync(1000);
		expect(await caught).toEqual(new Error("abortado"));
	});

	it("respeita o sinal de quem chamou", async () => {
		const outer = new AbortController();
		let inner: AbortSignal | undefined;
		const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			inner = init?.signal ?? undefined;
			return new Response("{}");
		});
		const wrapped = withTimeout(fetchImpl, 1000);
		outer.abort();
		await wrapped("http://x", { signal: outer.signal });
		expect(inner?.aborted).toBe(true);
	});
});
