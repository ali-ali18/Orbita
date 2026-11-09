import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const config = JSON.parse(readFileSync(new URL("../app.json", import.meta.url), "utf8")) as {
	expo: { android: { permissions: string[]; blockedPermissions: string[] }; plugins: unknown[] };
};

describe("app.json (microfone)", () => {
	it("declara RECORD_AUDIO e não o bloqueia", () => {
		expect(config.expo.android.permissions).toContain("RECORD_AUDIO");
		expect(config.expo.android.blockedPermissions).not.toContain("android.permission.RECORD_AUDIO");
	});
	it("nenhum plugin bloqueia o microfone (expo-image-picker com microphonePermission:false remove RECORD_AUDIO)", () => {
		for (const plugin of config.expo.plugins) {
			if (Array.isArray(plugin)) expect(plugin[1]).not.toMatchObject({ microphonePermission: false });
		}
	});
});
