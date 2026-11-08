import type { PreferencesRecord } from "@orbita/db";
import {
	type NotificationSettingsDto,
	notificationSettingsPatchBody,
	type PreferencesDto,
	type ProfileDto,
	preferencesPatchBody,
	profilePatchBody,
} from "@orbita/shared";
import { Hono } from "hono";
import { defined, orNotFound } from "../../http/errors.ts";
import type { ModuleDeps } from "../../http/module-deps.ts";
import type { AppEnv } from "../../http/require-device.ts";
import { validate } from "../../http/validate.ts";

const toProfile = (p: PreferencesRecord, deviceName: string): ProfileDto => ({
	displayName: p.displayName,
	deviceName,
});

const toPreferences = (p: PreferencesRecord): PreferencesDto => ({
	defaultAccountId: p.defaultAccountId,
	budgetAlertPercent: p.budgetAlertPercent,
	leftoverAccountId: p.leftoverAccountId,
	leftoverGoalId: p.leftoverGoalId,
});

/** `active` é sempre `false`: a leitura das notificações do banco ainda não existe (o app avisa na tela). */
const toNotifications = (p: PreferencesRecord): NotificationSettingsDto => ({
	capture: p.notificationCapture,
	apps: p.notificationApps,
	toReview: p.notificationToReview,
	active: false,
});

/** Perfil (nome e aparelho), preferências e notificações do celular. Só configuração, nada financeiro. */
export function routes({ stores, requireDevice }: ModuleDeps) {
	const { preferences, auth } = stores;
	return new Hono<AppEnv>()
		.use("/v1/profile", requireDevice)
		.use("/v1/preferences", requireDevice)
		.use("/v1/notification-settings", requireDevice)
		.get("/v1/profile", async (c) =>
			c.json({ profile: toProfile(await preferences.get(), c.get("device").name) }),
		)
		.patch("/v1/profile", validate("json", profilePatchBody), async (c) => {
			const { displayName, deviceName } = c.req.valid("json");
			const device = c.get("device");
			// Valida tudo antes de gravar qualquer coisa: o nome do aparelho não muda se o nome do dono for recusado.
			const record =
				displayName === undefined ? await preferences.get() : await preferences.update({ displayName });
			let name = device.name;
			if (deviceName !== undefined) {
				name = orNotFound(
					await auth.renameDevice({ deviceId: device.id, name: deviceName }),
					"Aparelho",
					"o",
				).name;
			}
			return c.json({ profile: toProfile(record, name) });
		})
		.get("/v1/preferences", async (c) => c.json({ preferences: toPreferences(await preferences.get()) }))
		.patch("/v1/preferences", validate("json", preferencesPatchBody), async (c) =>
			c.json({ preferences: toPreferences(await preferences.update(defined(c.req.valid("json")))) }),
		)
		.get("/v1/notification-settings", async (c) =>
			c.json({ notifications: toNotifications(await preferences.get()) }),
		)
		.patch("/v1/notification-settings", validate("json", notificationSettingsPatchBody), async (c) => {
			const { capture, apps, toReview } = c.req.valid("json");
			const patch = defined({
				notificationCapture: capture,
				notificationApps: apps,
				notificationToReview: toReview,
			});
			return c.json({ notifications: toNotifications(await preferences.update(patch)) });
		});
}
