import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

/**
 * Leitura das notificações dos bancos (Android). O serviço nativo roda com o app fechado: lê só os pacotes de banco
 * ligados, joga fora código de verificação, guarda a fila cifrada e envia ao servidor pareado. Este arquivo é só a
 * ponte; a lógica está em `android/src/main/java/expo/modules/orbitanotifications/`.
 */
export interface CaptureStatus {
	/** O dono ligou o app em Configurações do Android › Acesso a notificações. */
	granted: boolean;
	/** Notificações lidas que esperam rede para ir ao servidor. */
	queued: number;
	/** Milissegundos desde 1970 do último envio com sucesso; 0 = nunca. */
	lastSentAt: number;
	/** Motivo do último envio que falhou, em português; `null` se o último deu certo. */
	lastError: string | null;
	/** O servidor recusou o token: só entrar de novo no app resolve. */
	authFailed: boolean;
}

interface NativeCapture {
	isAccessGranted(): boolean;
	openAccessSettings(): void;
	openAppSettings(): void;
	configure(baseUrl: string, token: string, packages: string[], enabled: boolean): void;
	clear(): void;
	getStatus(): CaptureStatus;
	flush(): Promise<void>;
}

/** `null` fora do Android (web, iOS) e em um APK sem o módulo: a tela explica que não está disponível. */
export const OrbitaNotifications: NativeCapture | null =
	Platform.OS === "android" ? requireOptionalNativeModule<NativeCapture>("OrbitaNotifications") : null;
