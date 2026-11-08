import { useRef, useState } from "react";
import { Linking } from "react-native";
import { useSession } from "../../lib/session.tsx";
import {
	CONNECT_OPEN_FAILED,
	CONNECT_PENDING_HINT,
	connectErrorMessage,
	connectUrl,
} from "./connect-model.ts";
import { usePluggyActions } from "./queries.ts";

/** Quando a página do Pluggy foi aberta e quais conexões existiam: ao voltar, confere o que apareceu. */
export interface ConnectOpened {
	at: number;
	ids: readonly string[];
}

/**
 * O fluxo do Pluggy Connect (sessão no servidor, página no navegador), compartilhado por quem abre "Conectar banco":
 * a tela Bancos e o aviso de banco desconectado no Início. `ids` são as conexões de agora.
 */
export function useConnectLauncher(ids: readonly string[]) {
	const { connect } = usePluggyActions();
	const { baseUrl } = useSession();
	const opened = useRef<ConnectOpened | null>(null);
	const locked = useRef(false);
	const [message, setMessage] = useState<string | null>(null);

	const start = async () => {
		if (locked.current || baseUrl === null) return;
		locked.current = true;
		setMessage(null);
		try {
			const { path } = await connect.mutateAsync();
			const url = connectUrl(baseUrl, path);
			if (!url) throw new Error(CONNECT_OPEN_FAILED);
			opened.current = { at: Date.now(), ids };
			await Linking.openURL(url);
			setMessage(CONNECT_PENDING_HINT);
		} catch (error) {
			opened.current = null;
			setMessage(
				error instanceof Error && error.message === CONNECT_OPEN_FAILED
					? CONNECT_OPEN_FAILED
					: connectErrorMessage(error),
			);
		} finally {
			locked.current = false;
		}
	};

	return { start, pending: connect.isPending, message, setMessage, opened };
}
