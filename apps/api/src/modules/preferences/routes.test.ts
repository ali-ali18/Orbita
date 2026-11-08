import { describe, expect, it } from "vitest";
import { setupFinance } from "../../test-support.ts";

describe("perfil", () => {
	it("exige o token", async () => {
		const { call } = await setupFinance();
		for (const path of ["/v1/profile", "/v1/preferences", "/v1/notification-settings"]) {
			expect((await call("GET", path, undefined, null)).status).toBe(401);
			expect((await call("PATCH", path, {}, null)).status).toBe(401);
		}
	});

	it("começa sem nome e mostra o aparelho", async () => {
		const { api } = await setupFinance();
		expect((await api.get("/v1/profile")).body).toEqual({
			profile: { displayName: null, deviceName: "Teste" },
		});
	});

	it("grava o nome do dono e o nome do aparelho, e o /v1/server enxerga o novo nome", async () => {
		const { api } = await setupFinance();
		const res = await api.patch("/v1/profile", { displayName: "  Alisson ", deviceName: "Galaxy S24" });
		expect(res.status).toBe(200);
		expect(res.body).toEqual({ profile: { displayName: "Alisson", deviceName: "Galaxy S24" } });
		expect((await api.get("/v1/profile")).body.profile).toEqual({
			displayName: "Alisson",
			deviceName: "Galaxy S24",
		});
		expect((await api.get("/v1/server")).body.device.name).toBe("Galaxy S24");
		expect((await api.patch("/v1/profile", { displayName: null })).body.profile).toEqual({
			displayName: null,
			deviceName: "Galaxy S24",
		});
	});

	it("recusa corpo vazio, nome vazio, nome longo e campo desconhecido", async () => {
		const { api } = await setupFinance();
		expect((await api.patch("/v1/profile", {})).status).toBe(400);
		expect((await api.patch("/v1/profile", { displayName: "  " })).status).toBe(400);
		expect((await api.patch("/v1/profile", { displayName: "x".repeat(41) })).body.error.message).toBe(
			"O nome tem até 40 letras.",
		);
		expect((await api.patch("/v1/profile", { deviceName: "" })).status).toBe(400);
		expect((await api.patch("/v1/profile", { email: "a@b.c" })).status).toBe(400);
		expect((await api.get("/v1/profile")).body.profile.displayName).toBeNull();
	});
});

describe("preferências", () => {
	it("guarda a conta padrão e recusa conta que não existe ou está arquivada", async () => {
		const { api, basics } = await setupFinance();
		const { account } = await basics();
		expect((await api.get("/v1/preferences")).body).toEqual({
			preferences: { defaultAccountId: null, budgetAlertPercent: 80, leftoverAccountId: null },
		});
		expect((await api.patch("/v1/preferences", { defaultAccountId: account.id })).body).toMatchObject({
			preferences: { defaultAccountId: account.id },
		});
		expect((await api.patch("/v1/preferences", { defaultAccountId: "fantasma" })).status).toBe(422);
		const old = (await api.post("/v1/accounts", { name: "Antiga", kind: "savings" })).body.account;
		await api.delete(`/v1/accounts/${old.id}`);
		expect((await api.patch("/v1/preferences", { defaultAccountId: old.id })).status).toBe(422);
		expect((await api.get("/v1/preferences")).body.preferences.defaultAccountId).toBe(account.id);
		expect((await api.patch("/v1/preferences", { defaultAccountId: null })).body.preferences).toMatchObject({
			defaultAccountId: null,
		});
		expect((await api.patch("/v1/preferences", {})).status).toBe(400);
	});
});

describe("notificações do celular", () => {
	it("guarda as escolhas e diz que a captura ainda não está ativa", async () => {
		const { api } = await setupFinance();
		expect((await api.get("/v1/notification-settings")).body).toEqual({
			notifications: { capture: false, apps: [], toReview: true, active: false },
		});
		const res = await api.patch("/v1/notification-settings", {
			capture: true,
			apps: ["inter", "nubank", "inter"],
		});
		expect(res.body).toEqual({
			notifications: { capture: true, apps: ["nubank", "inter"], toReview: true, active: false },
		});
		expect((await api.patch("/v1/notification-settings", { toReview: false })).body.notifications).toEqual({
			capture: true,
			apps: ["nubank", "inter"],
			toReview: false,
			active: false,
		});
	});

	it("recusa app desconhecido, tipo errado e corpo vazio; tentar ligar `active` é ignorado como campo extra", async () => {
		const { api } = await setupFinance();
		expect((await api.patch("/v1/notification-settings", { apps: ["banco-x"] })).status).toBe(400);
		expect((await api.patch("/v1/notification-settings", { capture: "sim" })).status).toBe(400);
		expect((await api.patch("/v1/notification-settings", {})).status).toBe(400);
		expect((await api.patch("/v1/notification-settings", { active: true })).status).toBe(400);
	});
});
