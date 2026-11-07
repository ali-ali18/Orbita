import { useLocalSearchParams } from "expo-router";
import { TransactionDetailScreen } from "../../features/transactions/TransactionDetailScreen.tsx";

export default function LancamentoRoute() {
	const { id } = useLocalSearchParams<{ id: string }>();
	return <TransactionDetailScreen id={id} />;
}
