import { DISPLAY_NAME_MAX, NOTIFICATION_APPS, type NotificationApp } from "@orbita/shared";
import { invalid } from "./errors.ts";
import type { PreferencesPatch } from "./preferences-store.ts";
import { cleanText } from "./rules.ts";

/** Normaliza o patch (mesma regra e mesma mensagem nos stores Prisma e memória). A conta é conferida por quem tem o banco. */
export function cleanPreferencesPatch(patch: PreferencesPatch): PreferencesPatch {
	const out: PreferencesPatch = {};
	if (patch.displayName !== undefined) {
		out.displayName =
			patch.displayName === null ? null : cleanText(patch.displayName, "o nome", DISPLAY_NAME_MAX);
	}
	if (patch.defaultAccountId !== undefined) out.defaultAccountId = patch.defaultAccountId;
	if (patch.leftoverAccountId !== undefined) out.leftoverAccountId = patch.leftoverAccountId;
	if (patch.budgetAlertPercent !== undefined) {
		const p = patch.budgetAlertPercent;
		if (!Number.isInteger(p) || p < 1 || p > 100) throw invalid("O aviso vai de 1% a 100%.");
		out.budgetAlertPercent = p;
	}
	if (patch.notificationCapture !== undefined) out.notificationCapture = patch.notificationCapture === true;
	if (patch.notificationToReview !== undefined)
		out.notificationToReview = patch.notificationToReview === true;
	if (patch.notificationApps !== undefined) {
		const known = new Set<string>(NOTIFICATION_APPS);
		const apps = [...new Set<string>(patch.notificationApps)];
		if (apps.some((a) => !known.has(a))) throw invalid("App de banco desconhecido.");
		// Ordem fixa (a da lista de apps): a mesma escolha sempre gera o mesmo registro.
		out.notificationApps = NOTIFICATION_APPS.filter((a): a is NotificationApp => apps.includes(a));
	}
	return out;
}
