import { DEFAULT_INVESTMENT_EVOLUTION_RANGE, type InvestmentEvolutionRange } from "@orbita/shared";
import { colors, layout, radius, spacing } from "@orbita/tokens";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { money } from "../../lib/format.ts";
import { toLoadable } from "../../lib/loadable.ts";
import { usePrivacy } from "../../lib/privacy.tsx";
import { Card, ErrorState, LineChart, Skeleton, Text } from "../../ui/index.ts";
import { DetailScreen } from "../summary/DetailScreen.tsx";
import {
	barHeights,
	emptyYield,
	evolutionChart,
	type MonthBar,
	monthBars,
	NO_BALANCE,
	RANGE_OPTIONS,
} from "./investments-model.ts";
import { EmptyNote, evolutionSeries, incompleteDaysLabel, PillTabs } from "./parts.tsx";
import { useInvestmentEvolution, useInvestments } from "./queries.ts";

/** Uma barra de aporte e uma de rendimento por mês, na mesma escala; tocar num mês põe os dois valores no cabeçalho. */
function MonthlyCard({ bars }: { bars: readonly MonthBar[] }) {
	const [picked, setPicked] = useState<string | null>(null);
	const selected = bars.find((b) => b.month === picked) ?? bars.at(-1);
	const both = bars.flatMap((b) => [b.contributionsCents, b.yieldCents]);
	const heights = barHeights(both, layout.monthBarArea, layout.monthBarMin);
	if (!selected) return null;
	return (
		<Card style={{ gap: spacing.md }}>
			<Text variant="cardTitle" tone="secondary" accessibilityRole="header">
				Aportes e rendimento por mês
			</Text>
			<View accessible accessibilityLiveRegion="polite" style={{ gap: spacing.xs }}>
				<Text variant="caption" tone="secondary">
					{selected.label}
				</Text>
				<View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: spacing.sm }}>
					<Text variant="bodyStrong">{`Aporte ${selected.contribution}`}</Text>
					<Text variant="bodyStrong" tone={selected.yieldTone}>
						{`· ${selected.yieldText}`}
					</Text>
				</View>
				{selected.withdrawal ? (
					<Text variant="caption" tone="secondary">{`Resgate ${selected.withdrawal}`}</Text>
				) : null}
			</View>
			<View style={{ flexDirection: "row", height: layout.monthBarArea, alignItems: "flex-end" }}>
				{bars.map((b, i) => {
					const on = b.month === selected.month;
					return (
						<Pressable
							key={b.month}
							accessibilityRole="button"
							accessibilityLabel={`${b.label}: aporte ${b.contribution}, ${b.yieldText}`}
							accessibilityState={{ selected: on }}
							onPress={() => setPicked(b.month)}
							style={{
								flex: 1,
								height: layout.monthBarArea,
								alignItems: "center",
								justifyContent: "flex-end",
							}}
						>
							<View style={{ flexDirection: "row", alignItems: "flex-end", gap: 2 }}>
								<View
									style={{
										width: layout.monthBarWidth,
										height: heights[i * 2] ?? 0,
										borderRadius: radius.pill,
										backgroundColor: on ? colors.text : colors.textTertiary,
									}}
								/>
								<View
									style={{
										width: layout.monthBarWidth,
										height: heights[i * 2 + 1] ?? 0,
										borderRadius: radius.pill,
										backgroundColor: (b.yieldCents ?? 0) < 0 ? colors.danger : colors.positive,
										opacity: on ? 1 : 0.55,
									}}
								/>
							</View>
						</Pressable>
					);
				})}
			</View>
			<View style={{ height: 1, backgroundColor: colors.border }} />
			<View style={{ flexDirection: "row" }}>
				{bars.map((b) => (
					<Text
						key={b.month}
						variant="micro"
						tone={b.month === selected.month ? "primary" : "secondary"}
						style={{ flex: 1, textAlign: "center" }}
					>
						{b.label}
					</Text>
				))}
			</View>
			<View style={{ flexDirection: "row", gap: spacing.lg }}>
				<Legend color={colors.textTertiary} label="Aportes" />
				<Legend color={colors.positive} label="Rendimento (mesma escala)" />
			</View>
		</Card>
	);
}

function Legend({ color, label, dashed = false }: { color: string; label: string; dashed?: boolean }) {
	return (
		<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
			<View
				style={{
					width: spacing.sm,
					height: dashed ? 2 : spacing.sm,
					borderRadius: radius.pill,
					backgroundColor: color,
				}}
			/>
			<Text variant="caption" tone="secondary">
				{label}
			</Text>
		</View>
	);
}

/** "Evolução": a linha do patrimônio e do aplicado (por faixa) e os aportes e o rendimento mês a mês. */
export function EvolutionScreen() {
	const { hidden } = usePrivacy();
	const [range, setRange] = useState<InvestmentEvolutionRange>(DEFAULT_INVESTMENT_EVOLUTION_RANGE);
	const evolutionQ = useInvestmentEvolution(range);
	const overviewQ = useInvestments();
	const evolution = toLoadable(evolutionQ);
	const overview = toLoadable(overviewQ);

	return (
		<DetailScreen title="Evolução">
			<PillTabs options={RANGE_OPTIONS} value={range} onChange={setRange} />
			{evolution.phase === "loading" ? (
				<Skeleton height={300} />
			) : evolution.phase === "error" ? (
				<ErrorState message={evolution.message} onRetry={evolution.retry} />
			) : (
				(() => {
					const chart = evolutionChart(evolution.data);
					const label =
						chart.lastBalanceCents === null ? null : money(chart.lastBalanceCents, hidden, { sign: "never" });
					return (
						<Card style={{ gap: spacing.md }}>
							<Text variant="cardTitle" tone="secondary" accessibilityRole="header">
								Patrimônio
							</Text>
							{chart.balanceRuns.length === 0 ? (
								chart.onlyIncomplete ? (
									<Text variant="body" tone="secondary">
										{`Dias incompletos: ${incompleteDaysLabel(chart.hiddenDays)}`}
									</Text>
								) : (
									<EmptyNote
										empty={emptyYield(evolution.data.reason ?? "sem histórico ainda")}
										arrange="column"
									/>
								)
							) : (
								<>
									<Text variant="numberLarge" adjustsFontSizeToFit numberOfLines={1}>
										{label ?? NO_BALANCE}
									</Text>
									<Text variant="caption" tone="secondary">
										{[chart.lastBalanceLabel, chart.span].filter(Boolean).join(" · ")}
									</Text>
									<LineChart
										height={layout.lineChart}
										xMax={chart.xMax}
										yMax={chart.yMax}
										label={`Evolução do patrimônio ${chart.span ?? ""}${label ? `, ${label} ${chart.lastBalanceLabel ?? ""}` : ""}`}
										series={evolutionSeries(chart)}
									/>
									<View style={{ flexDirection: "row", justifyContent: "space-between" }}>
										{chart.ticks.map((t) => (
											<Text key={t.label + t.at} variant="micro" tone="secondary">
												{t.label}
											</Text>
										))}
									</View>
									<View style={{ flexDirection: "row", gap: spacing.lg }}>
										<Legend color={colors.text} label="Patrimônio" />
										<Legend
											color={colors.textTertiary}
											label={chart.investedEstimated ? "Aplicado (estimado)" : "Aplicado"}
											dashed
										/>
									</View>
									{chart.hiddenDays > 0 ? (
										<Text variant="caption" tone="secondary">
											{`${incompleteDaysLabel(chart.hiddenDays)} ficaram de fora`}
										</Text>
									) : null}
								</>
							)}
						</Card>
					);
				})()
			)}
			{overview.phase === "ready" && overview.data.monthly.length > 0 ? (
				<MonthlyCard bars={monthBars(overview.data.monthly, hidden)} />
			) : overview.phase === "error" ? (
				<ErrorState message={overview.message} onRetry={overview.retry} />
			) : null}
		</DetailScreen>
	);
}
