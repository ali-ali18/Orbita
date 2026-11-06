import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getItem, KEYS, setItem } from "./storage.ts";

interface PrivacyValue {
	/** Olho fechado: os valores em dinheiro viram ••••. Fica `true` até a preferência ser lida. */
	hidden: boolean;
	/** A preferência já foi lida do armazenamento. */
	loaded: boolean;
	toggle: () => void;
}

const PrivacyContext = createContext<PrivacyValue>({ hidden: true, loaded: false, toggle: () => {} });

export function PrivacyProvider({ children }: { children: ReactNode }) {
	const [preference, setPreference] = useState<boolean | null>(null);

	useEffect(() => {
		getItem(KEYS.hideValues)
			.then((v) => setPreference(v === "1"))
			.catch(() => setPreference(false));
	}, []);

	const toggle = useCallback(() => {
		setPreference((current) => {
			if (current === null) return current;
			setItem(KEYS.hideValues, current ? "0" : "1").catch(() => {});
			return !current;
		});
	}, []);

	const value = useMemo(
		() => ({ hidden: preference ?? true, loaded: preference !== null, toggle }),
		[preference, toggle],
	);
	return <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>;
}

export const usePrivacy = () => useContext(PrivacyContext);
