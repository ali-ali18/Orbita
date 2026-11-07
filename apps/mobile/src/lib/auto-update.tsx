import Constants from "expo-constants";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useSession } from "./session.tsx";
import { createUpdateChecker } from "./updates.ts";
import { nativeUpdatesPort } from "./updates-native.ts";

/** Sem interface: ao abrir e ao voltar ao primeiro plano, baixa a atualização OTA para a próxima abertura. */
export function AutoUpdate() {
	const { baseUrl } = useSession();
	const checker = useRef(
		createUpdateChecker(nativeUpdatesPort, {
			otaUpdateUrl: String(Constants.expoConfig?.extra?.otaUpdateUrl ?? "") || null,
		}),
	);

	useEffect(() => {
		void checker.current.run(baseUrl);
		const sub = AppState.addEventListener("change", (s) => {
			if (s === "active") void checker.current.run(baseUrl);
		});
		return () => sub.remove();
	}, [baseUrl]);

	return null;
}
