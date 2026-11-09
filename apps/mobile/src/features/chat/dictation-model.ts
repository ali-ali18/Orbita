/*
 * Ditado por voz, em funções puras (o reconhecimento em si fica em `use-dictation.ts`). O texto falado entra no campo
 * de digitar; o dono revisa e envia. Nada é enviado sozinho.
 */

/** Idioma do reconhecimento. */
export const DICTATION_LOCALE = "pt-BR";

/** Junta o que já estava digitado com a fala (parcial ou final), com um espaço no meio. */
export function mergeDictation(base: string, transcript: string): string {
	const spoken = transcript.trim();
	if (!spoken) return base;
	if (!base.trim()) return spoken;
	return /\s$/.test(base) ? `${base}${spoken}` : `${base} ${spoken}`;
}

/** Mensagem em pt-BR para o erro do reconhecimento; `null` quando não vale mostrar nada (ex.: o dono parou). */
export function dictationErrorMessage(code: string): string | null {
	switch (code) {
		case "aborted":
			return null;
		case "not-allowed":
		case "service-not-allowed":
			return "Permita o microfone nas configurações do aparelho para ditar.";
		case "no-speech":
		case "speech-timeout":
			return "Não ouvi nada. Toque no microfone e fale de novo.";
		case "network":
			return "Sem conexão para entender a fala. Tente de novo.";
		case "language-not-supported":
			return "Este aparelho ainda não entende português para ditar.";
		case "audio-capture":
			return "Não consegui usar o microfone agora.";
		case "busy":
		case "client":
			return "O reconhecimento de voz está ocupado. Tente de novo em instantes.";
		default:
			return "Não consegui entender a fala. Tente de novo.";
	}
}

/** O que o ditado faz depois do pedido de permissão do microfone. */
export type DictationPermissionOutcome = "start" | "denied-ask-again" | "denied-settings";

/**
 * Decide o passo seguinte com a resposta do pedido de permissão (feito sempre ao tocar no microfone): concedida começa
 * a ouvir; negada que ainda pode ser pedida só avisa curto; negada de vez (`canAskAgain` falso) manda o dono para as
 * configurações do aparelho.
 */
export function dictationPermissionOutcome(permission: {
	granted: boolean;
	canAskAgain?: boolean | undefined;
}): DictationPermissionOutcome {
	if (permission.granted) return "start";
	return permission.canAskAgain === false ? "denied-settings" : "denied-ask-again";
}

/** Mensagem para a permissão negada; `null` quando concedida. */
export function dictationPermissionMessage(outcome: DictationPermissionOutcome): string | null {
	switch (outcome) {
		case "start":
			return null;
		case "denied-ask-again":
			return "Toque no microfone de novo e permita o acesso para ditar.";
		case "denied-settings":
			return "Permita o microfone nas configurações do aparelho para ditar.";
	}
}

/** Texto da primeira alternativa do resultado do reconhecimento (parcial ou final). */
export function transcriptOf(results: ReadonlyArray<{ transcript: string }> | undefined): string {
	return results?.[0]?.transcript ?? "";
}
