import { ApiError } from "../../lib/api.ts";
import { errorMessage } from "../../lib/loadable.ts";
import { addErrorMessage, parseConnectionInput, parseRenameInput } from "./banks-model.ts";

/** Estado da gaveta "Adicionar conexão" e da confirmação de remover, como função pura. */

export interface AddFormState {
	itemId: string;
	label: string;
	message: string | null;
	busy: boolean;
}

export const initialAddForm: AddFormState = { itemId: "", label: "", message: null, busy: false };

export type AddFormAction =
	| { type: "id"; text: string }
	| { type: "label"; text: string }
	| { type: "started" }
	| { type: "failed"; message: string };

export function addFormReducer(state: AddFormState, action: AddFormAction): AddFormState {
	switch (action.type) {
		case "id":
			return { ...state, itemId: action.text, message: null };
		case "label":
			return { ...state, label: action.text, message: null };
		case "started":
			return { ...state, busy: true, message: null };
		case "failed":
			return { ...state, busy: false, message: action.message };
	}
}

export type ConnectionOutcome = { status: "saved" } | { status: "invalid" | "failed"; message: string };

export async function submitConnection(
	form: Pick<AddFormState, "itemId" | "label">,
	add: (body: { itemId: string; label?: string }) => Promise<void>,
): Promise<ConnectionOutcome> {
	const parsed = parseConnectionInput(form.itemId, form.label);
	if (!parsed.ok) return { status: "invalid", message: parsed.message };
	try {
		await add({ itemId: parsed.itemId, ...(parsed.label ? { label: parsed.label } : {}) });
		return { status: "saved" };
	} catch (error) {
		return { status: "failed", message: addErrorMessage(error) };
	}
}

export async function removeConnection(
	id: string,
	remove: (id: string) => Promise<void>,
): Promise<ConnectionOutcome> {
	try {
		await remove(id);
		return { status: "saved" };
	} catch (error) {
		// 404: a conexão já não existe (removida em outro aparelho); o objetivo foi atingido.
		if (error instanceof ApiError && error.status === 404) return { status: "saved" };
		return { status: "failed", message: errorMessage(error) };
	}
}

/** Salva o novo nome. 404: a conexão sumiu (removida em outro aparelho). */
export async function renameConnection(
	text: string,
	rename: (label: string) => Promise<void>,
): Promise<ConnectionOutcome> {
	const parsed = parseRenameInput(text);
	if (!parsed.ok) return { status: "invalid", message: parsed.message };
	try {
		await rename(parsed.label);
		return { status: "saved" };
	} catch (error) {
		if (error instanceof ApiError && error.status === 404) {
			return { status: "failed", message: "Esta conexão não existe mais. Volte e atualize a lista." };
		}
		return { status: "failed", message: errorMessage(error) };
	}
}
