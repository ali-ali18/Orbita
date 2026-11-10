import { DISPLAY_NAME_MAX, NOTIFICATION_APPS, type NotificationApp } from "@orbita/shared";
import { invalid } from "./errors.ts";
import { LEFTOVER_ONE_TARGET_MESSAGE } from "./messages.ts";
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
	if (patch.leftoverGoalId !== undefined) out.leftoverGoalId = patch.leftoverGoalId;
	// A sobra tem um destino só: escolher um desfaz o outro.
	if (out.leftoverAccountId && out.leftoverGoalId) throw invalid(LEFTOVER_ONE_TARGET_MESSAGE);
	if (out.leftoverAccountId) out.leftoverGoalId = null;
	if (out.leftoverGoalId) out.leftoverAccountId = null;
	if (patch.budgetAlertPercent !== undefined) {
		const p = patch.budgetAlertPercent;
		if (!Number.isInteger(p) || p < 1 || p > 100) throw invalid("O aviso vai de 1% a 100%.");
		out.budgetAlertPercent = p;
	}
	if (patch.notificationCapture !== undefined) out.notificationCapture = patch.notificationCapture === true;
	if (patch.notificationToReview !== undefined)
		out.notificationToReview = patch.notificationToReview === true;
	if (patch.notificationAskFirst !== undefined)
		out.notificationAskFirst = patch.notificationAskFirst === true;
	if (patch.notificationApps !== undefined) {
		const known = new Set<string>(NOTIFICATION_APPS);
		const apps = [...new Set<string>(patch.notificationApps)];
		if (apps.some((a) => !known.has(a))) throw invalid("App de banco desconhecido.");
		// Ordem fixa (a da lista de apps): a mesma escolha sempre gera o mesmo registro.
		out.notificationApps = NOTIFICATION_APPS.filter((a): a is NotificationApp => apps.includes(a));
	}
	return out;
}
