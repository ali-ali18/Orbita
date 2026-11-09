import { describe, expect, it } from "vitest";
import { loadSpeech } from "./speech-module.ts";

describe("loadSpeech", () => {
	it("módulo nativo ausente (o require lança) não derruba: sem módulo e hook inerte", () => {
		const api = loadSpeech(() => {
			throw new Error("Cannot find native module 'ExpoSpeechRecognition'");
		});
		expect(api.module).toBeNull();
		expect(() =>
			(api.useEvent as unknown as (name: string, cb: () => void) => void)("start", () => {}),
		).not.toThrow();
	});

	it("módulo incompleto também vira inerte; completo é usado", () => {
		expect(loadSpeech(() => ({})).module).toBeNull();
		const module = { isRecognitionAvailable: () => true };
		const handler = () => {};
		expect(
			loadSpeech(() => ({ ExpoSpeechRecognitionModule: module, useSpeechRecognitionEvent: handler })),
		).toEqual({ module, useEvent: handler });
	});
});
