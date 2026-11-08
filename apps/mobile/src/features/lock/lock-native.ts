import * as LocalAuthentication from "expo-local-authentication";
import { type AuthOutcome, type Availability, type BiometricPort, mapAuthResult } from "./lock-model.ts";

/**
 * Liga `BiometricPort` ao módulo nativo. O módulo só existe em APK construído com `expo-local-authentication`; como
 * isso muda o `runtimeVersion`, um APK antigo nunca recebe por OTA o JS que importa este arquivo.
 */
export const nativeBiometricPort: BiometricPort = {
	async availability(): Promise<Availability> {
		try {
			if (!(await LocalAuthentication.hasHardwareAsync())) return "no-hardware";
			return (await LocalAuthentication.isEnrolledAsync()) ? "ready" : "not-enrolled";
		} catch {
			return "no-hardware";
		}
	},
	async authenticate(promptMessage: string): Promise<AuthOutcome> {
		try {
			const result = await LocalAuthentication.authenticateAsync({
				promptMessage,
				cancelLabel: "Cancelar",
				// PIN/padrão do aparelho como alternativa à digital.
				disableDeviceFallback: false,
			});
			return mapAuthResult(result.success ? { success: true } : { success: false, error: result.error });
		} catch {
			return { success: false, reason: "failed" };
		}
	},
};
