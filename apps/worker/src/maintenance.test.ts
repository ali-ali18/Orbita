import { createMemoryAuthStore } from "@orbita/db";
import { describe, expect, it } from "vitest";
import { cleanPairingCodes } from "./maintenance.ts";

describe("cleanPairingCodes", () => {
	it("apaga só o que venceu há mais de um dia", async () => {
		const store = createMemoryAuthStore();
		const day = 24 * 60 * 60_000;
		const now = new Date("2026-11-06T12:00:00Z");
		const ago = (ms: number) => new Date(now.getTime() - ms);
		await store.replaceActivePairingCode({
			codeHash: "antigo",
			expiresAt: ago(2 * day),
			now: ago(2 * day + 1),
		});
		await store.replaceActivePairingCode({
			codeHash: "recente",
			expiresAt: ago(60_000),
			now: ago(2 * 60_000),
		});
		const { deleted } = await cleanPairingCodes({ store, now: () => now });
		expect(deleted).toBe(1);
		expect(store.codes.map((c) => c.codeHash)).toEqual(["recente"]);
	});
});
