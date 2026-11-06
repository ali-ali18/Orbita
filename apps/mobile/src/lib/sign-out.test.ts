import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { revokeOnServer } from "./sign-out.ts";

describe("revokeOnServer", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("204 e 401 contam como avisado", async () => {
		expect(await revokeOnServer(async () => ({ status: 204 }))).toEqual({ notified: true });
		expect(await revokeOnServer(async () => ({ status: 401 }))).toEqual({ notified: true });
	});
	it("erro do servidor ou rede fora do ar: não avisado", async () => {
		expect(await revokeOnServer(async () => ({ status: 500 }))).toEqual({ notified: false });
		expect(
			await revokeOnServer(async () => {
				throw new Error("rede");
			}),
		).toEqual({ notified: false });
	});
	it("servidor que não responde: desiste no tempo limite", async () => {
		const pending = revokeOnServer(() => new Promise(() => {}), 1000);
		await vi.advanceTimersByTimeAsync(1000);
		expect(await pending).toEqual({ notified: false });
	});
});
