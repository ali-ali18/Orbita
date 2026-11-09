import type * as SpeechRecognition from "expo-speech-recognition";

/*
 * `expo-speech-recognition` é um módulo nativo: num APK sem ele (ou com defeito), importá-lo no topo derrubaria a
 * tela do chat na carga. Aqui ele é lido com `require` dentro de try; ausente, o ditado fica indisponível (o
 * microfone some) e os hooks viram no-op.
 */

type Module = typeof SpeechRecognition;

export interface SpeechApi {
	/** `null` quando o módulo nativo não está disponível. */
	module: Module["ExpoSpeechRecognitionModule"] | null;
	/** Mesmo contrato de `useSpeechRecognitionEvent`; no-op sem o módulo. */
	useEvent: Module["useSpeechRecognitionEvent"];
}

const noopUseEvent = (() => {}) as unknown as Module["useSpeechRecognitionEvent"];

/** Lê o módulo com a função dada (o `require`); qualquer falha devolve a versão inerte. */
export function loadSpeech(load: () => unknown): SpeechApi {
	try {
		const loaded = load() as Partial<Module> | null | undefined;
		if (loaded?.ExpoSpeechRecognitionModule && typeof loaded.useSpeechRecognitionEvent === "function") {
			return { module: loaded.ExpoSpeechRecognitionModule, useEvent: loaded.useSpeechRecognitionEvent };
		}
	} catch {
		// módulo nativo ausente ou com defeito
	}
	return { module: null, useEvent: noopUseEvent };
}

export const speech: SpeechApi = loadSpeech(() => require("expo-speech-recognition"));
