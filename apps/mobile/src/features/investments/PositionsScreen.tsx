import { spacing } from "@orbita/tokens";
import { useLocalSearchParams, useRouter } from "expo-router";
import { toLoadable } from "../../lib/loadable.ts";
import { usePrivacy } from "../../lib/privacy.tsx";
import { Card, ErrorState, Skeleton, Text } from "../../ui/index.ts";
import { DetailScreen } from "../summary/DetailScreen.tsx";
import { positionRow } from "./investments-model.ts";
import { PositionLine } from "./parts.tsx";
import { useInvestments } from "./queries.ts";

/** Todas as posições ativas, do maior saldo para o menor (a ordem vem da API). */
export function PositionsScreen() {
	const router = useRouter();
	const { completar } = useLocalSearchParams<{ completar?: string }>();
	const { hidden } = usePrivacy();
	const data = toLoadable(useInvestments());
	// Vindo do chip "N a completar": só as posições com algo a completar.
	const rows =
		data.phase === "ready"
			? data.data.positions
					.map((p) => positionRow(p, hidden))
					.filter((r) => completar !== "1" || r.needsTerms)
			: [];
	return (
		<DetailScreen title={completar === "1" ? "A completar" : "Posições"}>
			{data.phase === "loading" ? (
				<Skeleton height={220} />
			) : data.phase === "error" ? (
				<ErrorState message={data.message} onRetry={data.retry} />
			) : rows.length === 0 ? (
				<Text variant="body" tone="secondary">
					Nenhuma posição ativa.
				</Text>
			) : (
				<Card style={{ gap: spacing.sm }}>
					{rows.map((row) => (
						<PositionLine
							key={row.id}
							row={row}
							onPress={() => router.push({ pathname: "/investimento", params: { id: row.id } })}
						/>
					))}
				</Card>
			)}
		</DetailScreen>
	);
}
