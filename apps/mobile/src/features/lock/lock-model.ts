/*
 * Bloqueio do app por biometria: regras puras. O relógio entra por parâmetro (`now`) e a chamada nativa fica atrás de
 * `BiometricPort`, então nada aqui precisa do módulo nativo. É só uma trava de tela (veja docs/seguranca.md).
 */

/** Quanto tempo o app pode ficar em segundo plano sem pedir a digital de novo. */
export const GRACE_MS = 30_000;

/** O que o aparelho oferece para autenticar. */
export type Availability = "ready" | "no-hardware" | "not-enrolled";

export type AuthOutcome =
	| { success: true }
	/** `cancelled`: a pessoa fechou o aviso. `failed`: não reconheceu. `unavailable`: sem como autenticar neste aparelho. */
	| { success: false; reason: "cancelled" | "failed" | "unavailable" };

/** Porta para o módulo nativo (`expo-local-authentication`), injetada para os testes não dependerem dele. */
export interface BiometricPort {
	availability(): Promise<Availability>;
	/** Mostra o aviso do sistema (digital, com PIN/padrão do aparelho como alternativa). */
	authenticate(promptMessage: string): Promise<AuthOutcome>;
}

export const MESSAGES = {
	noHardware: "Este aparelho não tem leitor de digital nem reconhecimento facial.",
	notEnrolled:
		"Nenhuma digital cadastrada neste aparelho. Cadastre uma nas configurações do Android e tente de novo.",
	enableFailed: "Não consegui confirmar a digital. O desbloqueio continua desligado.",
	unlockFailed: "Não reconheci. Tente de novo.",
	unlockCancelled: "Desbloqueio cancelado.",
	enablePrompt: "Confirme para ativar o desbloqueio",
	unlockPrompt: "Desbloquear o Órbita",
} as const;

/** Preferência guardada como texto no armazenamento seguro. */
export function parsePreference(raw: string | null): boolean {
	return raw === "1";
}

export function serializePreference(on: boolean): string {
	return on ? "1" : "0";
}

/**
 * Traduz a resposta do módulo nativo. Cancelamentos e falhas de leitura são recuperáveis; falta de hardware,
 * de cadastro ou de PIN/padrão no aparelho é `unavailable`.
 */
export function mapAuthResult(result: { success: boolean; error?: string }): AuthOutcome {
	if (result.success) return { success: true };
	switch (result.error) {
		case "user_cancel":
		case "system_cancel":
		case "app_cancel":
		case "user_fallback":
			return { success: false, reason: "cancelled" };
		case "not_enrolled":
		case "not_available":
		case "passcode_not_set":
			return { success: false, reason: "unavailable" };
		default:
			return { success: false, reason: "failed" };
	}
}

export type EnableResult = { ok: true } | { ok: false; message: string | null };

/**
 * Ligar o bloqueio exige o aparelho ter digital cadastrada e a pessoa passar pelo aviso agora.
 * `message: null` = ela desistiu, não há o que explicar.
 */
export async function requestEnable(port: BiometricPort): Promise<EnableResult> {
	const availability = await port.availability();
	if (availability === "no-hardware") return { ok: false, message: MESSAGES.noHardware };
	if (availability === "not-enrolled") return { ok: false, message: MESSAGES.notEnrolled };
	const outcome = await port.authenticate(MESSAGES.enablePrompt);
	if (outcome.success) return { ok: true };
	if (outcome.reason === "cancelled") return { ok: false, message: null };
	return { ok: false, message: MESSAGES.enableFailed };
}

/** Precisa travar? Falha para o lado seguro: relógio que andou para trás conta como "passou da tolerância". */
export function shouldLock(backgroundedAt: number, now: number, graceMs: number = GRACE_MS): boolean {
	const elapsed = now - backgroundedAt;
	return elapsed < 0 || elapsed >= graceMs;
}

export interface LockState {
	/** Bloqueio ligado nas configurações. */
	enabled: boolean;
	status: "loading" | "unlocked" | "locked";
	/** O aviso do sistema está aberto: mudanças de primeiro/segundo plano causadas por ele são ignoradas. */
	authenticating: boolean;
	/** Quando o app foi para o segundo plano (sessão destravada), ou `null`. */
	backgroundedAt: number | null;
	message: string | null;
}

export type LockEvent =
	| { type: "loaded"; enabled: boolean }
	| { type: "enabled-changed"; enabled: boolean }
	| { type: "background"; now: number }
	| { type: "foreground"; now: number }
	| { type: "auth-start" }
	| { type: "auth-result"; outcome: AuthOutcome };

export const initialLockState: LockState = {
	enabled: false,
	status: "loading",
	authenticating: false,
	backgroundedAt: null,
	message: null,
};

const unlocked = (enabled: boolean): LockState => ({
	enabled,
	status: "unlocked",
	authenticating: false,
	backgroundedAt: null,
	message: null,
});

export function lockReducer(state: LockState, event: LockEvent): LockState {
	switch (event.type) {
		case "loaded":
			// Abertura a frio: com o bloqueio ligado, começa travado.
			if (state.status !== "loading") return state;
			return event.enabled ? { ...unlocked(true), status: "locked" } : unlocked(false);
		case "enabled-changed":
			// Quem liga acabou de passar pelo aviso; quem desliga já estava dentro do app.
			return state.status === "loading" ? state : unlocked(event.enabled);
		case "background":
			if (!state.enabled || state.status !== "unlocked" || state.authenticating) return state;
			return state.backgroundedAt === null ? { ...state, backgroundedAt: event.now } : state;
		case "foreground":
			if (state.backgroundedAt === null) return state;
			return shouldLock(state.backgroundedAt, event.now)
				? { ...state, status: "locked", backgroundedAt: null, message: null }
				: { ...state, backgroundedAt: null };
		case "auth-start":
			return state.status === "locked" && !state.authenticating ? { ...state, authenticating: true } : state;
		case "auth-result": {
			if (state.status !== "locked") return { ...state, authenticating: false };
			const { outcome } = event;
			if (outcome.success) return unlocked(state.enabled);
			// Sem como autenticar (PIN/padrão e digitais removidos): travar para sempre trancaria a pessoa fora.
			if (outcome.reason === "unavailable") return unlocked(false);
			return {
				...state,
				authenticating: false,
				message: outcome.reason === "cancelled" ? MESSAGES.unlockCancelled : MESSAGES.unlockFailed,
			};
		}
	}
}

/** A tela de bloqueio cobre o app? Também cobre enquanto ele está em segundo plano (miniatura de apps recentes). */
export function isCovered(state: LockState): boolean {
	return state.enabled && (state.status === "locked" || state.backgroundedAt !== null);
}
