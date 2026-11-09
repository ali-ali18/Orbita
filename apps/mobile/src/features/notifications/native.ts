import { type CaptureStatus, OrbitaNotifications } from "../../../modules/orbita-notifications/index.ts";

/*
 * Ponte tipada para o serviço nativo que lê as notificações dos bancos (só no Android, e só em um APK que já traga o
 * módulo). Tudo aqui é melhor esforço: se o módulo não existe ou falha, a tela cai no estado "não disponível" em vez
 * de quebrar. O token passa para o módulo (que o guarda cifrado com o Keystore do Android) para o envio em segundo
 * plano funcionar com o app fechado.
 */

export const captureSupported = OrbitaNotifications !== null;

export function readCaptureStatus(): CaptureStatus | null {
	try {
		return OrbitaNotifications ? OrbitaNotifications.getStatus() : null;
	} catch {
		return null;
	}
}

export function openAccessSettings(): void {
	try {
		OrbitaNotifications?.openAccessSettings();
	} catch {}
}

export function openAppSettings(): void {
	try {
		OrbitaNotifications?.openAppSettings();
	} catch {}
}

/** Passa ao serviço o servidor, o token e os pacotes dos bancos ligados. `enabled: false` mantém tudo, mas não lê nada. */
export function configureCapture(config: {
	baseUrl: string;
	token: string;
	packages: string[];
	enabled: boolean;
}): void {
	try {
		OrbitaNotifications?.configure(config.baseUrl, config.token, config.packages, config.enabled);
	} catch {}
}

/** Sair do app: o serviço esquece servidor, token e a fila. */
export function clearCapture(): void {
	try {
		OrbitaNotifications?.clear();
	} catch {}
}

/** Manda a fila agora (ao abrir o app). */
export async function flushCapture(): Promise<void> {
	try {
		await OrbitaNotifications?.flush();
	} catch {}
}
