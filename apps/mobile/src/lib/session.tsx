import { useQueryClient } from "@tanstack/react-query";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { clearCapture } from "../features/notifications/native.ts";
import { type Api, createApi } from "./api.ts";
import { NOT_NOTIFIED_MESSAGE, revokeOnServer, SESSION_ENDED_MESSAGE } from "./sign-out.ts";
import { getItem, KEYS, removeItem, setItem } from "./storage.ts";
import { createUnauthorizedGuard } from "./unauthorized.ts";

type SessionState =
	| { status: "loading" }
	| { status: "out" }
	| { status: "in"; baseUrl: string; token: string };

interface SessionValue {
	state: SessionState;
	/** Cliente tipado da API, ou `null` enquanto não há sessão. */
	api: Api | null;
	baseUrl: string | null;
	/** Aviso mostrado na tela Conectar depois de sair (uma vez). */
	notice: string | null;
	clearNotice: () => void;
	signIn: (baseUrl: string, token: string) => Promise<void>;
	/** Sai deste aparelho: avisa o servidor (melhor esforço), apaga o token e limpa o cache de dados. */
	signOut: () => Promise<void>;
	/** Chamado quando o servidor recusa o token (401): sai sem tentar revogar. Dispara uma vez. */
	handleQueryError: (error: unknown) => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
	const queryClient = useQueryClient();
	const [state, setState] = useState<SessionState>({ status: "loading" });
	const [notice, setNotice] = useState<string | null>(null);
	const stateRef = useRef(state);
	stateRef.current = state;

	useEffect(() => {
		let cancelled = false;
		(async () => {
			const [baseUrl, token] = await Promise.all([getItem(KEYS.baseUrl), getItem(KEYS.token)]).catch(
				() => [null, null] as const,
			);
			if (cancelled) return;
			setState(baseUrl && token ? { status: "in", baseUrl, token } : { status: "out" });
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	const finishSignOut = useCallback(
		async (message: string | null) => {
			// Mantém o endereço: ao reconectar, o campo já vem preenchido.
			await removeItem(KEYS.token).catch(() => {});
			// O serviço de notificações também esquece servidor, token e fila (nada fica para trás num aparelho "saído").
			clearCapture();
			setNotice(message);
			setState({ status: "out" });
			queryClient.clear();
		},
		[queryClient],
	);

	const guard = useRef(createUnauthorizedGuard(() => {}));
	guard.current = useMemo(
		() => createUnauthorizedGuard(() => void finishSignOut(SESSION_ENDED_MESSAGE)),
		[finishSignOut],
	);

	const signIn = useCallback(async (baseUrl: string, token: string) => {
		await setItem(KEYS.baseUrl, baseUrl);
		await setItem(KEYS.token, token);
		guard.current.reset();
		setNotice(null);
		setState({ status: "in", baseUrl, token });
	}, []);

	const signOut = useCallback(async () => {
		const current = stateRef.current;
		let notified = true;
		if (current.status === "in") {
			const api = createApi(current.baseUrl, current.token);
			({ notified } = await revokeOnServer(() => api.v1.devices.current.$delete()));
		}
		await finishSignOut(notified ? null : NOT_NOTIFIED_MESSAGE);
	}, [finishSignOut]);

	const handleQueryError = useCallback((error: unknown) => {
		if (stateRef.current.status === "in") guard.current.handle(error);
	}, []);

	const value = useMemo<SessionValue>(() => {
		const api = state.status === "in" ? createApi(state.baseUrl, state.token) : null;
		return {
			state,
			api,
			baseUrl: state.status === "in" ? state.baseUrl : null,
			notice,
			clearNotice: () => setNotice(null),
			signIn,
			signOut,
			handleQueryError,
		};
	}, [state, notice, signIn, signOut, handleQueryError]);

	return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
	const value = useContext(SessionContext);
	if (!value) throw new Error("useSession fora do SessionProvider");
	return value;
}
