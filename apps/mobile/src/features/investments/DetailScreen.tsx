import { colors, layout, spacing } from "@orbita/tokens";
import { useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { money } from "../../lib/format.ts";
import { toLoadable } from "../../lib/loadable.ts";
import { usePrivacy } from "../../lib/privacy.tsx";
import { BankLogo, Card, ErrorState, LineChart, Skeleton, Text } from "../../ui/index.ts";
import { DetailScreen } from "../summary/DetailScreen.tsx";
import { bankBadge } from "../summary/summary-model.ts";
import {
	detailLines,
	emptyYield,
	investedCard,
	movementRow,
	NO_BALANCE,
	positionTitle,
	positionYield,
	sinceLabel,
	snapshotsChart,
} from "./investments-model.ts";
import { EmptyNote, evolutionSeries, YieldTile } from "./parts.tsx";
import { useInvestmentDetail } from "./queries.ts";

function Line({ label, value, last }: { label: string; value: string; last: boolean }) {
	return (
		<View
			accessible
			accessibilityLabel={`${label}, ${value}`}
			style={{
				flexDirection: "row",
				alignItems: "center",
				gap: spacing.lg,
				minHeight: layout.touchTarget,
				borderBottomWidth: last ? 0 : 1,
				borderBottomColor: colors.border,
			}}
		>
			<Text variant="body" tone="secondary" style={{ flex: 1 }}>
				{label}
			</Text>
			<Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
				{value}
			</Text>
		</View>
	);
}

/** Detalhe de uma posição: valor atual, aplicado, rendimento, linha do valor, dados do banco e movimentações. */
export function InvestmentDetailScreen() {
	const { id } = useLocalSearchParams<{ id: string }>();
	const { hidden } = usePrivacy();
	const data = toLoadable(useInvestmentDetail(id));

	if (data.phase !== "ready") {
		return (
			<DetailScreen title="Investimento">
				{data.phase === "loading" ? (
					<View accessibilityLabel="Carregando" style={{ gap: spacing.md }}>
						<Skeleton width="60%" height={46} />
						<Skeleton height={120} />
					</View>
				) : (
					<ErrorState message={data.message} onRetry={data.retry} />
				)}
			</DetailScreen>
		);
	}

	const { position: p, movements, snapshots } = data.data;
	const badge = bankBadge({ name: p.institutionLabel });
	const lines = detailLines(p, hidden);
	const chart = snapshotsChart(snapshots);
	const rows = movements.map((m) => movementRow(m, hidden));

	return (
		<DetailScreen
			title={positionTitle(p)}
			caption={`${p.institutionLabel} · ${p.classLabel.toLowerCase()}${p.active ? "" : " · encerrada"}`}
		>
			<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
				<BankLogo {...badge} size={40} />
				<View style={{ flex: 1 }}>
					<Text variant="caption" tone="secondary">
						Valor atual
					</Text>
					<Text variant="numberHero" adjustsFontSizeToFit numberOfLines={1}>
						{p.balanceCents === null ? NO_BALANCE : money(p.balanceCents, hidden, { sign: "never" })}
					</Text>
				</View>
			</View>
			<View style={{ flexDirection: "row", gap: spacing.md }}>
				<YieldTile label="Aplicado" y={investedCard(p.investedCents, sinceLabel(p), hidden)} />
				<YieldTile label="Rendimento" y={positionYield(p.yield, hidden)} />
			</View>
			{p.yield.reason && p.yield.cents !== null ? (
				<Text variant="caption" tone="secondary">
					{p.yield.reason}
				</Text>
			) : null}
			<Card style={{ gap: spacing.md }}>
				<Text variant="cardTitle" tone="secondary" accessibilityRole="header">
					Valor da posição
				</Text>
				{chart.balanceRuns.length > 0 && snapshots.length > 1 ? (
					<LineChart
						height={layout.lineChartSmall}
						xMax={chart.xMax}
						yMax={chart.yMax}
						label={`Valor da posição ${chart.span ?? ""}`}
						series={evolutionSeries(chart)}
					/>
				) : (
					<EmptyNote empty={emptyYield("sem histórico ainda")} arrange="column" />
				)}
			</Card>
			{lines.length > 0 ? (
				<Card style={{ paddingVertical: spacing.sm }}>
					{lines.map((l, i) => (
						<Line key={l.label} label={l.label} value={l.value} last={i === lines.length - 1} />
					))}
				</Card>
			) : null}
			<Card style={{ gap: spacing.sm }}>
				<Text variant="cardTitle" tone="secondary" accessibilityRole="header">
					Movimentações
				</Text>
				{rows.length === 0 ? (
					<Text variant="body" tone="secondary">
						Nenhuma movimentação.
					</Text>
				) : (
					rows.map((r) => (
						<View
							key={r.id}
							accessible
							accessibilityLabel={`${r.title}, ${r.date}, ${r.value}`}
							style={{
								flexDirection: "row",
								alignItems: "center",
								gap: spacing.md,
								minHeight: layout.movementRow,
							}}
						>
							<View style={{ flex: 1 }}>
								<Text variant="bodyStrong" numberOfLines={1}>
									{r.title}
								</Text>
								<Text variant="caption" tone="secondary">
									{r.date}
								</Text>
							</View>
							<Text variant="bodyStrong">{r.value}</Text>
						</View>
					))
				)}
			</Card>
		</DetailScreen>
	);
}
