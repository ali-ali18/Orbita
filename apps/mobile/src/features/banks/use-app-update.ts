import { useCallback, useEffect, useState } from "react";
import { useSession } from "../../lib/session.tsx";
import { type AppUpdateSnapshot, formatAppUpdate, runResultLabel } from "../../lib/update-diagnostics.ts";
import { appUpdateChecker, readNativeUpdateErrors, readNativeUpdateInfo } from "../../lib/updates-native.ts";
import { useServerInfo } from "../settings/queries.ts";

/**
 * Estado do bloco "Atualização do app" do Diagnóstico: o texto (função pura em `update-diagnostics.ts`), a
 * checagem manual (ignora o intervalo de 15 minutos) e o reinício que aplica a atualização baixada.
 */
export function useAppUpdate() {
	const { baseUrl } = useSession();
	const server = useServerInfo();
	const [checking, setChecking] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const [checker, setChecker] = useState(() => appUpdateChecker.state());
	const [nativeErrors, setNativeErrors] = useState<string[]>([]);

	const refresh = useCallback(async () => {
		setChecker(appUpdateChecker.state());
		setNativeErrors(await readNativeUpdateErrors());
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const checkNow = useCallback(async () => {
		setChecking(true);
		setMessage(null);
		const result = await appUpdateChecker.run(baseUrl, { force: true });
		await Promise.all([refresh(), server.refetch()]);
		const error = result === "error" ? appUpdateChecker.state().last?.error : null;
		setMessage(error ? `Não deu para conferir: ${error}` : `Resultado: ${runResultLabel(result)}.`);
		setChecking(false);
	}, [baseUrl, refresh, server.refetch]);

	const applyNow = useCallback(async () => {
		if (!(await appUpdateChecker.applyPending({ force: true }))) {
			setMessage("Não deu para reiniciar sozinho. Feche o app e abra de novo para aplicar.");
		}
	}, []);

	const snapshot: AppUpdateSnapshot = {
		...readNativeUpdateInfo(),
		pairedBaseUrl: baseUrl,
		last: checker.last,
		pending: checker.pending,
		// Servidor antigo não manda `ota`: fica "não informado".
		server: server.data ? server.data.ota : undefined,
		nativeErrors,
	};

	return { text: formatAppUpdate(snapshot), pending: checker.pending, checking, message, checkNow, applyNow };
}
