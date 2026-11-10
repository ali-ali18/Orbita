import { requireOptionalNativeModule } from "expo";
import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { nativeErrorLine } from "./update-diagnostics.ts";
import { createUpdateChecker, type UpdatesPort } from "./updates.ts";

/** Liga a lógica de `updates.ts` ao módulo nativo. Tudo isto só existe em build de release com o certificado. */
export const nativeUpdatesPort: UpdatesPort = {
	get isEnabled() {
		return Updates.isEnabled;
	},
	check: () => Updates.checkForUpdateAsync(),
	download: () => Updates.fetchUpdateAsync(),
	reload: () => Updates.reloadAsync(),
};

/** Endereço de atualização embutido no APK (`extra.otaUpdateUrl`, de ORBITA_PUBLIC_URL no build). */
export const OTA_UPDATE_URL: string | null = String(Constants.expoConfig?.extra?.otaUpdateUrl ?? "") || null;

/** Um só para o app inteiro: o Diagnóstico mostra o resultado das checagens automáticas e dispara a manual. */
export const appUpdateChecker = createUpdateChecker(nativeUpdatesPort, { otaUpdateUrl: OTA_UPDATE_URL });

/**
 * versionName do APK. Depois de uma atualização OTA, `Constants.expoConfig` passa a ser o da atualização; o do
 * APK continua no módulo nativo do expo-constants (a config embutida no build).
 */
function apkVersionName(): string | null {
	try {
		const raw: unknown = requireOptionalNativeModule<{ manifest?: unknown }>("ExponentConstants")?.manifest;
		const config = (typeof raw === "string" ? JSON.parse(raw) : raw) as { version?: unknown } | null;
		return typeof config?.version === "string" ? config.version : null;
	} catch {
		return null;
	}
}

/** O que o módulo nativo sabe sobre o APK e a atualização em uso. Não lança. */
export function readNativeUpdateInfo() {
	const versionCode = Constants.platform?.android?.versionCode;
	return {
		apkVersion: apkVersionName(),
		apkBuild: versionCode ? String(versionCode) : null,
		jsVersion: Constants.expoConfig?.version ?? null,
		enabled: Updates.isEnabled,
		runtimeVersion: Updates.runtimeVersion,
		updateId: Updates.updateId,
		createdAt: Updates.createdAt ? Updates.createdAt.toISOString() : null,
		isEmbeddedLaunch: Updates.isEmbeddedLaunch,
		channel: Updates.channel,
		emergencyLaunchReason: Updates.emergencyLaunchReason,
		otaUpdateUrl: OTA_UPDATE_URL,
	};
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Os últimos erros do registro do expo-updates (um dia), já em texto. Vazio em dev ou se não der para ler. */
export async function readNativeUpdateErrors(limit = 5): Promise<string[]> {
	try {
		const entries = await Updates.readLogEntriesAsync(DAY_MS);
		return entries
			.filter((e) => e.level === "error" || e.level === "fatal")
			.slice(-limit)
			.map(nativeErrorLine);
	} catch {
		return [];
	}
}
