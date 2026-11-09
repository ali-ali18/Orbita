import { createContext, useContext } from "react";

/**
 * Segurar um widget do Início abre o menu dele. Cada widget entrega o gesto por este contexto e os toques de dentro
 * (card, linha, faixa) o usam: um toque que tem `onPress` engole o segurar do que está em volta, então cada um
 * repassa o seu. Fora de um widget o valor é `undefined` e nada muda.
 */
export const LongPressContext = createContext<(() => void) | undefined>(undefined);

export const useWidgetLongPress = () => useContext(LongPressContext);
