import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition";
import { useCallback, useRef, useState } from "react";
import { DICTATION_LOCALE, dictationErrorMessage, mergeDictation, transcriptOf } from "./dictation-model.ts";

/** O aparelho (ou o navegador) sabe reconhecer fala? Sem isso o botão do microfone nem aparece. */
function recognitionAvailable(): boolean {
	try {
		return ExpoSpeechRecognitionModule.isRecognitionAvailable();
	} catch {
		return false;
	}
}

/**
 * Ditado por voz para o campo de texto do chat. Reconhecimento em português do Brasil, com resultados parciais; no
 * aparelho (sem mandar áudio para fora) quando ele tem o pacote de voz offline, senão pelo serviço de voz do sistema.
 * O texto falado vai para o campo, junto do que já estava digitado; o dono revisa e envia.
 */
export function useDictation({ draft, onDraft }: { draft: string; onDraft: (text: string) => void }) {
	const [listening, setListening] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [supported] = useState(recognitionAvailable);
	// O que estava digitado quando o ditado começou: a fala é sempre somada a isto, não ao parcial anterior.
	const base = useRef("");

	useSpeechRecognitionEvent("start", () => setListening(true));
	useSpeechRecognitionEvent("end", () => setListening(false));
	useSpeechRecognitionEvent("result", (event) => {
		onDraft(mergeDictation(base.current, transcriptOf(event.results)));
	});
	useSpeechRecognitionEvent("error", (event) => {
		setListening(false);
		setError(dictationErrorMessage(event.error));
	});

	const toggle = useCallback(async () => {
		if (listening) {
			ExpoSpeechRecognitionModule.stop();
			return;
		}
		setError(null);
		try {
			const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
			if (!permission.granted) {
				setError(dictationErrorMessage("not-allowed"));
				return;
			}
			base.current = draft;
			ExpoSpeechRecognitionModule.start({
				lang: DICTATION_LOCALE,
				interimResults: true,
				continuous: false,
				addsPunctuation: true,
				requiresOnDeviceRecognition: ExpoSpeechRecognitionModule.supportsOnDeviceRecognition(),
			});
		} catch {
			setError(dictationErrorMessage("unknown"));
		}
	}, [listening, draft]);

	/** Para o ditado sem esperar (ao enviar a mensagem). */
	const cancel = useCallback(() => {
		if (listening) ExpoSpeechRecognitionModule.abort();
	}, [listening]);

	return { supported, listening, error, toggle, cancel };
}
