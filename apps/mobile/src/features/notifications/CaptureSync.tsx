import { useEffect } from "react";
import { AppState } from "react-native";
import { useSession } from "../../lib/session.tsx";
import { useNotificationSettings } from "../settings/preferences-queries.ts";
import { packagesFor } from "./capture-model.ts";
import { captureSupported, configureCapture, flushCapture } from "./native.ts";

/**
 * Mantém o serviço nativo de leitura de notificações em dia com as escolhas guardadas no servidor (ligada, bancos) e
 * com a sessão (servidor e token). Não aparece na tela. O serviço roda sozinho com o app fechado; aqui só se
 * entrega a configuração e, ao abrir o app, se manda o que ficou na fila.
 */
function Sync({ baseUrl, token }: { baseUrl: string; token: string }) {
	const settings = useNotificationSettings();
	const data = settings.data;
	const refetch = settings.refetch;

	useEffect(() => {
		// Sem resposta ainda (ou sem rede): vale a última configuração, que o serviço guarda.
		if (!data) return;
		configureCapture({
			baseUrl,
			token,
			packages: packagesFor(data.apps),
			enabled: data.capture && data.apps.length > 0,
		});
	}, [baseUrl, token, data]);

	useEffect(() => {
		const sub = AppState.addEventListener("change", (state) => {
			if (state !== "active") return;
			void refetch();
			void flushCapture();
		});
		return () => sub.remove();
	}, [refetch]);

	return null;
}

export function CaptureSync() {
	const { state } = useSession();
	if (!captureSupported || state.status !== "in") return null;
	return <Sync baseUrl={state.baseUrl} token={state.token} />;
}
