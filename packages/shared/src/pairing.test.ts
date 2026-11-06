import { describe, expect, it } from "vitest";
import { pairingClaimBody } from "./pairing.ts";

describe("pairingClaimBody", () => {
	it("aceita 6 dígitos e nome do aparelho", () => {
		expect(pairingClaimBody.parse({ code: " 482913 ", deviceName: "Galaxy" })).toEqual({
			code: "482913",
			deviceName: "Galaxy",
		});
	});

	it.each(["48291", "4829134", "48a913", ""])("recusa código %j", (code) => {
		expect(pairingClaimBody.safeParse({ code, deviceName: "Galaxy" }).success).toBe(false);
	});

	it("recusa nome vazio ou longo demais", () => {
		expect(pairingClaimBody.safeParse({ code: "482913", deviceName: "  " }).success).toBe(false);
		expect(pairingClaimBody.safeParse({ code: "482913", deviceName: "x".repeat(61) }).success).toBe(false);
	});
});
