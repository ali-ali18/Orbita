import type { AccentThemeKey } from "@orbita/tokens";
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
import { getItem, KEYS, setItem } from "./storage.ts";
import { type Accent, accentOf, resolveAccentTheme } from "./theme-model.ts";

interface ThemeValue extends Accent {
	/** O tema guardado já foi lido; o app segura a splash até lá para não piscar de branco para a cor. */
	loaded: boolean;
	/** Troca na hora (a árvore inteira re-renderiza) e guarda neste aparelho. */
	setTheme: (key: AccentThemeKey) => void;
}

const ThemeContext = createContext<ThemeValue>({
	...accentOf(resolveAccentTheme(null)),
	loaded: false,
	setTheme: () => {},
});

/**
 * Dona da cor primária. É o único lugar que lê o tema escolhido: telas e componentes pedem `useAccent()` e nunca
 * `accentThemes` direto (há um teste que garante isso). Preferência deste aparelho, como "Esconder valores ao abrir".
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
	const [key, setKey] = useState<AccentThemeKey>(() => resolveAccentTheme(null));
	const [loaded, setLoaded] = useState(false);
	const chosen = useRef(false);

	useEffect(() => {
		let alive = true;
		getItem(KEYS.accentTheme)
			.then((stored) => {
				// Se a pessoa já escolheu enquanto lia, a escolha vale.
				if (alive && !chosen.current) setKey(resolveAccentTheme(stored));
			})
			.catch(() => {})
			.finally(() => {
				if (alive) setLoaded(true);
			});
		return () => {
			alive = false;
		};
	}, []);

	const setTheme = useCallback((next: AccentThemeKey) => {
		chosen.current = true;
		setKey(next);
		setItem(KEYS.accentTheme, next).catch(() => {});
	}, []);

	const value = useMemo(() => ({ ...accentOf(key), loaded, setTheme }), [key, loaded, setTheme]);
	return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** `{ key, accent, onAccent, loaded, setTheme }`. Fora do provider devolve o tema atual (branco). */
export const useTheme = () => useContext(ThemeContext);

/** Só as cores: `{ key, accent, onAccent }`. Para estilo que depende do tema (fundo de chip ativo, switch…). */
export function useAccent(): Accent {
	const { key, accent, onAccent } = useContext(ThemeContext);
	return useMemo(() => ({ key, accent, onAccent }), [key, accent, onAccent]);
}
