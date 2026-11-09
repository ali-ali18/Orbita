import { useLocalSearchParams } from "expo-router";
import { SpendingScreen } from "../features/summary/SpendingScreen.tsx";

/** `/gasto-do-mes?mes=2026-11`: gasto acumulado dia a dia contra o mês anterior. */
export default function GastoDoMesRoute() {
	const { mes } = useLocalSearchParams<{ mes?: string }>();
	const month = typeof mes === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(mes) ? mes : undefined;
	return <SpendingScreen {...(month ? { month } : {})} />;
}
