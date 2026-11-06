import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { type Api, createApi } from "./api.ts";
import { getItem, KEYS, removeItem, setItem } from "./storage.ts";

type SessionState =
	| { status: "loading" }
	| { status: "out" }
	| { status: "in"; baseUrl: string; token: string };

interface SessionValue {
	state: SessionState;
	/** Cliente tipado da API, ou `null` enquanto não há sessão. */
	api: Api | null;
	baseUrl: string | null;
	signIn: (baseUrl: string, token: string) => Promise<void>;
	signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
	const [state, setState] = useState<SessionState>({ status: "loading" });

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

	const signIn = useCallback(async (baseUrl: string, token: string) => {
		await setItem(KEYS.baseUrl, baseUrl);
		await setItem(KEYS.token, token);
		setState({ status: "in", baseUrl, token });
	}, []);

	const signOut = useCallback(async () => {
		// Mantém o endereço: ao reconectar, o campo já vem preenchido.
		await removeItem(KEYS.token);
		setState({ status: "out" });
	}, []);

	const value = useMemo<SessionValue>(() => {
		const api = state.status === "in" ? createApi(state.baseUrl, state.token) : null;
		return { state, api, baseUrl: state.status === "in" ? state.baseUrl : null, signIn, signOut };
	}, [state, signIn, signOut]);

	return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
	const value = useContext(SessionContext);
	if (!value) throw new Error("useSession fora do SessionProvider");
	return value;
}
