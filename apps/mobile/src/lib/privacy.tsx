import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { initialHidden } from "./privacy-model.ts";
import { getItem, KEYS, setItem } from "./storage.ts";

interface PrivacyValue {
	/** Olho fechado: os valores em dinheiro viram ••••. Fica `true` até a preferência ser lida. */
	hidden: boolean;
	/** A preferência já foi lida do armazenamento. */
	loaded: boolean;
	toggle: () => void;
	/** "Esconder valores ao abrir": o app sempre começa com o olho fechado. Preferência deste aparelho. */
	hideOnOpen: boolean;
	setHideOnOpen: (value: boolean) => void;
}

const PrivacyContext = createContext<PrivacyValue>({
	hidden: true,
	loaded: false,
	toggle: () => {},
	hideOnOpen: false,
	setHideOnOpen: () => {},
});

export function PrivacyProvider({ children }: { children: ReactNode }) {
	const [preference, setPreference] = useState<boolean | null>(null);
	const [hideOnOpen, setHideOnOpenState] = useState(false);

	useEffect(() => {
		Promise.all([getItem(KEYS.hideValues), getItem(KEYS.hideOnOpen)])
			.then(([stored, onOpen]) => {
				setHideOnOpenState(onOpen === "1");
				setPreference(initialHidden(stored, onOpen));
			})
			.catch(() => setPreference(false));
	}, []);

	const toggle = useCallback(() => {
		setPreference((current) => {
			if (current === null) return current;
			setItem(KEYS.hideValues, current ? "0" : "1").catch(() => {});
			return !current;
		});
	}, []);

	const setHideOnOpen = useCallback((value: boolean) => {
		setHideOnOpenState(value);
		setItem(KEYS.hideOnOpen, value ? "1" : "0").catch(() => {});
	}, []);

	const value = useMemo(
		() => ({ hidden: preference ?? true, loaded: preference !== null, toggle, hideOnOpen, setHideOnOpen }),
		[preference, toggle, hideOnOpen, setHideOnOpen],
	);
	return <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>;
}

export const usePrivacy = () => useContext(PrivacyContext);
