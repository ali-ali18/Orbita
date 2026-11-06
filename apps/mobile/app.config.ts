import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * Estende o `app.json`. No CI (`app-android.yml`) o build define:
 *  - ORBITA_VERSION_CODE: inteiro crescente a cada build (o Android só atualiza por cima se subir);
 *  - ORBITA_VERSION_SUFFIX: `+<sha curto>`, anexado ao `version` (vira o versionName do APK).
 * Sem as variáveis (dev local), vale o que está no app.json.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
	const code = Number(process.env.ORBITA_VERSION_CODE);
	const suffix = process.env.ORBITA_VERSION_SUFFIX ?? "";
	return {
		...config,
		name: config.name ?? "Órbita",
		slug: config.slug ?? "orbita",
		version: `${config.version ?? "0.1.0"}${suffix}`,
		android: {
			...config.android,
			...(Number.isInteger(code) && code > 0 ? { versionCode: code } : {}),
		},
	};
};
