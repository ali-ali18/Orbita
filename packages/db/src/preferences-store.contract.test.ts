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
			budgetAlertPercent: 80,
			leftoverAccountId: null,
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
			budgetAlertPercent: 80,
			leftoverAccountId: null,
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

	it("guarda o percentual do aviso de orçamento (1 a 100) e recusa o resto", async () => {
		expect((await stores.preferences.update({ budgetAlertPercent: 90 })).budgetAlertPercent).toBe(90);
		for (const bad of [0, 101, -5, 80.5, Number.NaN]) {
			await expect(stores.preferences.update({ budgetAlertPercent: bad })).rejects.toMatchObject({
				code: "invalid",
				message: "O aviso vai de 1% a 100%.",
			});
		}
		expect((await stores.preferences.get()).budgetAlertPercent).toBe(90);
		// Outros campos não mexem no percentual.
		expect((await stores.preferences.update({ displayName: "Ana" })).budgetAlertPercent).toBe(90);
	});

	it("a conta da sobra do mês precisa existir e estar ativa, e é independente da conta padrão", async () => {
		const account = await stores.accounts.create({ name: "Reserva", kind: "savings" });
		const other = await stores.accounts.create({ name: "Corrente", kind: "checking" });
		await stores.preferences.update({ defaultAccountId: other.id });
		const next = await stores.preferences.update({ leftoverAccountId: account.id });
		expect(next.leftoverAccountId).toBe(account.id);
		expect(next.defaultAccountId).toBe(other.id);
		await expect(stores.preferences.update({ leftoverAccountId: "fantasma" })).rejects.toMatchObject({
			code: "bad_reference",
		});
		const old = await stores.accounts.create({ name: "Antiga", kind: "savings" });
		await stores.accounts.archive(old.id);
		await expect(stores.preferences.update({ leftoverAccountId: old.id })).rejects.toMatchObject({
			code: "bad_reference",
		});
		expect((await stores.preferences.get()).leftoverAccountId).toBe(account.id);
		expect((await stores.preferences.update({ leftoverAccountId: null })).leftoverAccountId).toBeNull();
	});
});
