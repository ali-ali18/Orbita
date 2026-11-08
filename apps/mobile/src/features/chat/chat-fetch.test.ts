import { describe, expect, it, vi } from "vitest";

// Imita o `fetch` do navegador: lança "Illegal invocation" se for chamado com `this` de outro objeto.
vi.mock("expo/fetch", () => ({
	fetch: function fetch(this: unknown) {
		if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
		return Promise.resolve({ ok: true });
	},
}));

const { chatFetch } = await import("./chat-fetch.ts");

describe("chatFetch", () => {
	it("pode ser chamado como método de um objeto, como streamChat faz", async () => {
		const options = { fetchImpl: chatFetch };
		await expect(options.fetchImpl("http://x", { method: "POST", headers: {}, body: "" })).resolves.toEqual({
			ok: true,
		});
	});
});
