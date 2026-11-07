import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ConfigContext, ExpoConfig } from "expo/config";

/** Certificado público que o app usa para conferir a assinatura das atualizações OTA (a chave privada fica só no GitHub). */
const OTA_CERTIFICATE = "./certs/ota-certificate.pem";
/** Tem de ser o `keyid` com que o CI assina (o CLI lê daqui, via `expo config`). */
const OTA_KEY_ID = "orbita-ota";
/**
 * Endereço público do servidor (variável do repositório ORBITA_PUBLIC_URL, a mesma que o CI usa nas URLs do
 * manifesto assinado). Vira o `updates.url` do APK: fixo em tempo de build, o que mantém as proteções
 * anti-bricking do expo-updates. Sem ele (ou inválido, ou http), o OTA fica desligado.
 */
function otaUpdateUrl(raw: string | undefined): string | null {
	if (!raw) return null;
	try {
		const url = new URL(raw);
		if (url.protocol !== "https:" || url.search || url.hash || url.username || url.password) return null;
		return `${url.origin}${url.pathname.replace(/\/+$/, "")}/updates/manifest`;
	} catch {
		return null;
	}
}

/**
 * Estende o `app.json`. No CI (`app-android.yml`) o build define:
 *  - ORBITA_VERSION_CODE: inteiro crescente a cada build (o Android só atualiza por cima se subir);
 *  - ORBITA_VERSION_SUFFIX: `+<sha curto>`, anexado ao `version` (vira o versionName do APK).
 * Sem as variáveis (dev local), vale o que está no app.json.
 *
 * Atualização OTA (docs/servidor.md, "Atualizar o app sem APK"): só liga quando o certificado existe em
 * `certs/` E ORBITA_PUBLIC_URL está definida no build; senão o APK sai sem OTA. O runtimeVersion é a impressão digital do projeto nativo: quando algo nativo muda, o APK novo
 * ganha outro runtime e deixa de receber o JS antigo (e o contrário). `version` e `versionCode` não entram.
 */
export default ({ config, projectRoot }: ConfigContext): ExpoConfig => {
	const code = Number(process.env.ORBITA_VERSION_CODE);
	const suffix = process.env.ORBITA_VERSION_SUFFIX ?? "";
	const updateUrl = otaUpdateUrl(process.env.ORBITA_PUBLIC_URL);
	const certPath = join(projectRoot ?? process.cwd(), OTA_CERTIFICATE);
	const ota = updateUrl !== null && existsSync(certPath);
	return {
		...config,
		name: config.name ?? "Órbita",
		slug: config.slug ?? "orbita",
		version: `${config.version ?? "0.1.0"}${suffix}`,
		android: {
			...config.android,
			...(Number.isInteger(code) && code > 0 ? { versionCode: code } : {}),
		},
		...(ota
			? {
					runtimeVersion: { policy: "fingerprint" },
					// O app só checa se o servidor pareado for este (src/lib/auto-update.tsx).
					// `otaCertSha256`: o fingerprint não olha o CONTEÚDO do certificado; com o hash aqui, trocar o
					// certificado muda o runtimeVersion (APK antigo, com o certificado velho, para de receber OTA novo).
					extra: {
						...config.extra,
						otaUpdateUrl: updateUrl,
						otaCertSha256: createHash("sha256").update(readFileSync(certPath)).digest("hex"),
					},
					updates: {
						url: updateUrl,
						// Nada de checagem nativa na abertura: quem decide é o app, e só com o servidor pareado
						// (src/lib/auto-update.tsx). Se o JS novo quebrar, a recuperação de erros ainda busca a correção.
						checkAutomatically: "ON_ERROR_RECOVERY",
						codeSigningCertificate: OTA_CERTIFICATE,
						codeSigningMetadata: { keyid: OTA_KEY_ID, alg: "rsa-v1_5-sha256" },
					},
				}
			: { updates: { enabled: false } }),
	};
};
