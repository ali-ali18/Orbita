import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getItem, KEYS, setItem } from "./storage.ts";

interface PrivacyValue {
	/** Olho fechado: os valores em dinheiro viram ••••. */
	hidden: boolean;
	toggle: () => void;
}

const PrivacyContext = createContext<PrivacyValue>({ hidden: false, toggle: () => {} });

export function PrivacyProvider({ children }: { children: ReactNode }) {
	const [hidden, setHidden] = useState(false);

	useEffect(() => {
		getItem(KEYS.hideValues)
			.then((v) => setHidden(v === "1"))
			.catch(() => {});
	}, []);

	const toggle = useCallback(() => {
		setHidden((current) => {
			setItem(KEYS.hideValues, current ? "0" : "1").catch(() => {});
			return !current;
		});
	}, []);

	const value = useMemo(() => ({ hidden, toggle }), [hidden, toggle]);
	return <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>;
}

export const usePrivacy = () => useContext(PrivacyContext);
