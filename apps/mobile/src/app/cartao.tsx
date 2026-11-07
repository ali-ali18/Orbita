import { useLocalSearchParams } from "expo-router";
import { CardScreen } from "../features/card/CardScreen.tsx";
import { parseTab } from "../features/card/card-model.ts";

/** `/cartao?aba=faturas|parcelas|limites&cartao=<id>`. */
export default function CartaoRoute() {
	const { aba, cartao } = useLocalSearchParams<{ aba?: string; cartao?: string }>();
	return <CardScreen initialTab={parseTab(aba)} {...(cartao ? { initialCardId: cartao } : {})} />;
}
