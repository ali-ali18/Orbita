import { parseSecretValue, type SecretName } from "@orbita/shared";
import { errorMessage } from "../../lib/loadable.ts";

/*
 * Estado da gaveta de colar chave, como função pura. O valor digitado só existe aqui e é zerado ao
 * salvar; a gaveta inteira é desmontada ao fechar (o estado nasce vazio de novo). Mensagens nunca citam o valor.
 */

export interface SecretFormState {
	value: string;
	message: string | null;
	/** Gravando ou removendo: bloqueia novos toques. */
	busy: boolean;
	/** Mostra "Remover a chave?" no lugar do campo. */
	confirmingRemove: boolean;
}

export const initialSecretForm: SecretFormState = {
	value: "",
	message: null,
	busy: false,
	confirmingRemove: false,
};

export type SecretFormAction =
	| { type: "typed"; text: string }
	| { type: "invalid"; message: string }
	| { type: "started" }
	| { type: "saved" }
	| { type: "failed"; message: string }
	| { type: "ask-remove" }
	| { type: "cancel-remove" };

export function secretFormReducer(state: SecretFormState, action: SecretFormAction): SecretFormState {
	switch (action.type) {
		case "typed":
			return { ...state, value: action.text, message: null };
		case "invalid":
			return { ...state, message: action.message };
		case "started":
			return { ...state, busy: true, message: null };
		case "saved":
			return { ...initialSecretForm };
		case "failed":
			return { ...state, busy: false, message: action.message };
		case "ask-remove":
			return { ...state, confirmingRemove: true, message: null };
		case "cancel-remove":
			return { ...state, confirmingRemove: false, message: null };
	}
}

export type SubmitOutcome = { status: "invalid" | "failed"; message: string } | { status: "saved" };

/** Valida, grava e devolve o resultado. A mensagem de falha vem da API ou é genérica; nunca repete o valor. */
export async function submitSecret(
	name: SecretName,
	value: string,
	save: (name: SecretName, value: string) => Promise<void>,
): Promise<SubmitOutcome> {
	const parsed = parseSecretValue(name, value);
	if (!parsed.ok) return { status: "invalid", message: parsed.message };
	try {
		await save(name, parsed.value);
		return { status: "saved" };
	} catch (error) {
		return { status: "failed", message: errorMessage(error) };
	}
}

export async function removeSecret(
	name: SecretName,
	remove: (name: SecretName) => Promise<void>,
): Promise<SubmitOutcome> {
	try {
		await remove(name);
		return { status: "saved" };
	} catch (error) {
		return { status: "failed", message: errorMessage(error) };
	}
}
