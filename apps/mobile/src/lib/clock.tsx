import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { AppState } from "react-native";
import { type ClockState, clockAt, nextClock } from "./clock.ts";

const CHECK_EVERY_MS = 60_000;

const ClockContext = createContext<ClockState | null>(null);

/**
 * Única fonte de "hoje" e "mês" do app. Recalcula ao voltar para o primeiro plano e a cada minuto
 * (cobre a virada do dia com o app aberto); todas as consultas leem daqui.
 */
export function ClockProvider({ children }: { children: ReactNode }) {
	const [clock, setClock] = useState(() => clockAt(new Date()));

	useEffect(() => {
		const tick = () => setClock((prev) => nextClock(prev, new Date()));
		const sub = AppState.addEventListener("change", (s) => s === "active" && tick());
		const timer = setInterval(tick, CHECK_EVERY_MS);
		return () => {
			sub.remove();
			clearInterval(timer);
		};
	}, []);

	return <ClockContext.Provider value={clock}>{children}</ClockContext.Provider>;
}

export function useClock(): ClockState {
	const value = useContext(ClockContext);
	if (!value) throw new Error("useClock fora do ClockProvider");
	return value;
}
