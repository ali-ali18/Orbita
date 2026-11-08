import { beforeEach, describe, expect, it } from "vitest";
import { contractSuites } from "./contract-harness.ts";
import type { Stores } from "./stores.ts";

describe.each(contractSuites())("PreferencesStore (%s)", (_name, make) => {
	let stores: Stores;
	beforeEach(async () => {
		stores = await make();
	});

	it("sem registro devolve os padrões", async () => {
		expect(await stores.preferences.get()).toEqual({
			displayName: null,
			defaultAccountId: null,
			notificationCapture: false,
			notificationApps: [],
			notificationToReview: true,
		});
	});

	it("grava só o que foi enviado e guarda o resto", async () => {
		await stores.preferences.update({ displayName: "  Alisson  " });
		const next = await stores.preferences.update({
			notificationCapture: true,
			notificationApps: ["inter", "nubank"],
		});
		expect(next).toEqual({
			displayName: "Alisson",
			defaultAccountId: null,
			notificationCapture: true,
			// Ordem fixa e sem repetição, qualquer que seja a ordem enviada.
			notificationApps: ["nubank", "inter"],
			notificationToReview: true,
		});
		expect(await stores.preferences.get()).toEqual(next);
	});

	it("limpa o nome com null e rejeita nome vazio, longo e app desconhecido", async () => {
		await stores.preferences.update({ displayName: "Ana" });
		expect((await stores.preferences.update({ displayName: null })).displayName).toBeNull();
		await expect(stores.preferences.update({ displayName: "   " })).rejects.toMatchObject({
			code: "invalid",
		});
		await expect(stores.preferences.update({ displayName: "x".repeat(41) })).rejects.toMatchObject({
			code: "invalid",
		});
		await expect(
			// biome-ignore lint/suspicious/noExplicitAny: valor fora do tipo, como o que chegaria de um cliente
			stores.preferences.update({ notificationApps: ["banco-x" as any] }),
		).rejects.toMatchObject({ code: "invalid", message: "App de banco desconhecido." });
		expect((await stores.preferences.get()).displayName).toBeNull();
	});

	it("a conta padrão precisa existir e estar ativa", async () => {
		const account = await stores.accounts.create({ name: "Conta", kind: "checking" });
		expect((await stores.preferences.update({ defaultAccountId: account.id })).defaultAccountId).toBe(
			account.id,
		);
		await expect(stores.preferences.update({ defaultAccountId: "fantasma" })).rejects.toMatchObject({
			code: "bad_reference",
		});
		const old = await stores.accounts.create({ name: "Antiga", kind: "savings" });
		await stores.accounts.archive(old.id);
		await expect(stores.preferences.update({ defaultAccountId: old.id })).rejects.toMatchObject({
			code: "bad_reference",
		});
		expect((await stores.preferences.get()).defaultAccountId).toBe(account.id);
		expect((await stores.preferences.update({ defaultAccountId: null })).defaultAccountId).toBeNull();
	});
});
