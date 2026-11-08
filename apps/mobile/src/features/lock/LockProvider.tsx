import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useReducer,
	useRef,
} from "react";
import { AppState, Platform } from "react-native";
import { useSession } from "../../lib/session.tsx";
import { getItem, KEYS, setItem } from "../../lib/storage.ts";
import {
	type BiometricPort,
	type EnableResult,
	initialLockState,
	isCovered,
	type LockState,
	lockReducer,
	MESSAGES,
	parsePreference,
	requestEnable,
	serializePreference,
} from "./lock-model.ts";
import { nativeBiometricPort } from "./lock-native.ts";

interface LockValue {
	/** Este aparelho/plataforma pode usar o bloqueio (na web não). */
	supported: boolean;
	/** A preferência já foi lida. */
	loaded: boolean;
	enabled: boolean;
	state: LockState;
	covered: boolean;
	/** Liga (pedindo a digital antes) ou desliga o bloqueio. */
	setEnabled: (on: boolean) => Promise<EnableResult>;
	/** Abre o aviso do sistema para destravar. */
	unlock: () => Promise<void>;
}

const LockContext = createContext<LockValue | null>(null);

const SAVE_FAILED = "Não consegui salvar a preferência. Tente de novo.";

/**
 * Dono do estado de bloqueio. A lógica está em `lock-model.ts`; aqui só ficam as ligações com o mundo: armazenamento
 * seguro, `AppState`, relógio (`now`) e a porta biométrica, todos injetáveis.
 */
export function LockProvider({
	children,
	port = nativeBiometricPort,
	now = Date.now,
}: {
	children: ReactNode;
	port?: BiometricPort;
	now?: () => number;
}) {
	const supported = Platform.OS !== "web";
	const { state: session } = useSession();
	const [state, dispatch] = useReducer(lockReducer, initialLockState);
	const stateRef = useRef(state);
	stateRef.current = state;
	const busy = useRef(false);

	useEffect(() => {
		if (!supported) {
			dispatch({ type: "loaded", enabled: false });
			return;
		}
		let cancelled = false;
		getItem(KEYS.biometricLock)
			.then(parsePreference)
			.catch(() => false)
			.then((enabled) => {
				if (!cancelled) dispatch({ type: "loaded", enabled });
			});
		return () => {
			cancelled = true;
		};
	}, [supported]);

	useEffect(() => {
		const sub = AppState.addEventListener("change", (next) => {
			dispatch(next === "active" ? { type: "foreground", now: now() } : { type: "background", now: now() });
		});
		return () => sub.remove();
	}, [now]);

	const persist = useCallback(async (on: boolean): Promise<boolean> => {
		try {
			await setItem(KEYS.biometricLock, serializePreference(on));
			return true;
		} catch {
			return false;
		}
	}, []);

	const setEnabled = useCallback(
		async (on: boolean): Promise<EnableResult> => {
			if (!supported) return { ok: false, message: MESSAGES.noHardware };
			if (on) {
				const result = await requestEnable(port);
				if (!result.ok) return result;
			}
			if (!(await persist(on))) return { ok: false, message: SAVE_FAILED };
			dispatch({ type: "enabled-changed", enabled: on });
			return { ok: true };
		},
		[supported, port, persist],
	);

	const unlock = useCallback(async () => {
		if (busy.current || stateRef.current.status !== "locked") return;
		busy.current = true;
		dispatch({ type: "auth-start" });
		try {
			const outcome = await port.authenticate(MESSAGES.unlockPrompt);
			if (!outcome.success && outcome.reason === "unavailable") await persist(false);
			dispatch({ type: "auth-result", outcome });
		} finally {
			busy.current = false;
		}
	}, [port, persist]);

	// Sair deste aparelho apaga o token; a trava não faz mais sentido e não deve aparecer logo após parear de novo.
	useEffect(() => {
		if (session.status === "out" && state.enabled) void setEnabled(false);
	}, [session.status, state.enabled, setEnabled]);

	const value = useMemo<LockValue>(
		() => ({
			supported,
			loaded: state.status !== "loading",
			enabled: state.enabled,
			state,
			covered: isCovered(state),
			setEnabled,
			unlock,
		}),
		[supported, state, setEnabled, unlock],
	);
	return <LockContext.Provider value={value}>{children}</LockContext.Provider>;
}

export function useLock(): LockValue {
	const value = useContext(LockContext);
	if (!value) throw new Error("useLock fora do LockProvider");
	return value;
}
