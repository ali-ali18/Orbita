import { useLocalSearchParams } from "expo-router";
import { BreakdownScreen } from "../features/summary/BreakdownScreen.tsx";

/** `/gasto?mes=2026-11`: como o Gasto do mês foi somado. */
export default function GastoRoute() {
	const { mes } = useLocalSearchParams<{ mes?: string }>();
	const month = typeof mes === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(mes) ? mes : undefined;
	return <BreakdownScreen {...(month ? { month } : {})} />;
}
