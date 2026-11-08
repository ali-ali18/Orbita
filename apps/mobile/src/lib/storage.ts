import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/*
 * Token e endereço do servidor. No celular vão para o cofre do sistema (`expo-secure-store`).
 * Na web o cofre não existe: usamos `localStorage` (e, se ele falhar, memória) SOMENTE para as
 * prévias de desenvolvimento. O app de verdade é o Android; não guarde token real num navegador.
 */

const memory = new Map<string, string>();

function webStorage(): Storage | null {
	try {
		return typeof localStorage === "undefined" ? null : localStorage;
	} catch {
		return null;
	}
}

export async function getItem(key: string): Promise<string | null> {
	if (Platform.OS === "web") {
		try {
			return webStorage()?.getItem(key) ?? memory.get(key) ?? null;
		} catch {
			return memory.get(key) ?? null;
		}
	}
	return SecureStore.getItemAsync(key);
}

export async function setItem(key: string, value: string): Promise<void> {
	if (Platform.OS === "web") {
		memory.set(key, value);
		try {
			webStorage()?.setItem(key, value);
		} catch {}
		return;
	}
	await SecureStore.setItemAsync(key, value);
}

export async function removeItem(key: string): Promise<void> {
	if (Platform.OS === "web") {
		memory.delete(key);
		try {
			webStorage()?.removeItem(key);
		} catch {}
		return;
	}
	await SecureStore.deleteItemAsync(key);
}

export const KEYS = {
	baseUrl: "orbita.baseUrl",
	token: "orbita.token",
	hideValues: "orbita.hideValues",
	/** "done" quando a primeira configuração (boas-vindas até orçamento) terminou ou foi pulada. */
	onboarding: "orbita.onboarding",
} as const;
