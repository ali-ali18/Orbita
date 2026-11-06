import { describe, expect, it } from "vitest";
import { deriveKey } from "./keys.ts";

const secret = "s".repeat(48);

describe("deriveKey", () => {
	it("é determinística e tem 32 bytes", () => {
		const a = deriveKey(secret, "pairing-code");
		expect(a).toHaveLength(32);
		expect(a.equals(deriveKey(secret, "pairing-code"))).toBe(true);
	});

	it("cada finalidade gera uma chave diferente", () => {
		expect(deriveKey(secret, "pairing-code").equals(deriveKey(secret, "secret-box"))).toBe(false);
	});

	it("segredos diferentes geram chaves diferentes", () => {
		expect(deriveKey(secret, "secret-box").equals(deriveKey("t".repeat(48), "secret-box"))).toBe(false);
	});
});
