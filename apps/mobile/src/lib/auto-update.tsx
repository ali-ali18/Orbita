import { useEffect } from "react";
import { AppState } from "react-native";
import { useSession } from "./session.tsx";
import { appUpdateChecker } from "./updates-native.ts";

/**
 * Sem interface. Ao abrir e ao voltar ao primeiro plano, confere e baixa a atualização OTA. A atualização
 * baixada entra em uso quando o app VOLTA depois de pelo menos um minuto fora (o JavaScript reinicia na primeira
 * tela), ou no próximo início a frio: no Android, "abrir o app de novo" quase nunca é um início a frio, e sem
 * isto a atualização ficava baixada sem nunca aparecer. Nunca reinicia com o app em uso na tela, nem numa volta
 * rápida (ir ao app do banco e voltar não perde o rascunho).
 */
export function AutoUpdate() {
	const { baseUrl } = useSession();

	useEffect(() => {
		void appUpdateChecker.run(baseUrl);
		const sub = AppState.addEventListener("change", (state) => {
			if (state !== "active") {
				appUpdateChecker.noteBackground();
				return;
			}
			void appUpdateChecker.applyPending().then((reloading) => {
				if (!reloading) void appUpdateChecker.run(baseUrl);
			});
		});
		return () => sub.remove();
	}, [baseUrl]);

	return null;
}
