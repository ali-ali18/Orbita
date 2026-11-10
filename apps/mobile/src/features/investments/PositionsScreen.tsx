import { spacing } from "@orbita/tokens";
import { useRouter } from "expo-router";
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
	const { hidden } = usePrivacy();
	const data = toLoadable(useInvestments());
	return (
		<DetailScreen title="Posições">
			{data.phase === "loading" ? (
				<Skeleton height={220} />
			) : data.phase === "error" ? (
				<ErrorState message={data.message} onRetry={data.retry} />
			) : data.data.positions.length === 0 ? (
				<Text variant="body" tone="secondary">
					Nenhuma posição ativa.
				</Text>
			) : (
				<Card style={{ gap: spacing.sm }}>
					{data.data.positions.map((p) => (
						<PositionLine
							key={p.id}
							row={positionRow(p, hidden)}
							onPress={() => router.push({ pathname: "/investimento", params: { id: p.id } })}
						/>
					))}
				</Card>
			)}
		</DetailScreen>
	);
}
