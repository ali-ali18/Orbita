import { colors, layout, radius, spacing } from "@orbita/tokens";
import { View } from "react-native";
import { BankLogo, Card, DonutChart, Text } from "../../ui/index.ts";
import { ChartMenu, useChartMenu } from "./ChartMenu.tsx";
import { CHART_VIEW_LABELS, type ChartView } from "./chart-view.ts";
import { barHeights, type GroupRow, groupsA11y } from "./investments-model.ts";

/** Cor da série só no desenho (barra, arco, ponto): o texto nunca usa a cor da série. */
function Dot({ color }: { color: string }) {
	return (
		<View
			style={{ width: spacing.sm, height: spacing.sm, borderRadius: radius.pill, backgroundColor: color }}
		/>
	);
}

/** Barras verticais com chão comum; embaixo, em cada coluna, marca, nome, valor e participação. */
function BarsView({ rows }: { rows: readonly GroupRow[] }) {
	const heights = barHeights(
		rows.map((r) => r.weight),
		layout.barArea,
		layout.barMin,
	);
	return (
		<View>
			<View style={{ flexDirection: "row", height: layout.barArea, alignItems: "flex-end" }}>
				{rows.map((r, i) => (
					<View key={r.key} style={{ flex: 1, alignItems: "center" }}>
						<View
							style={{
								width: layout.barWidth,
								height: heights[i] ?? 0,
								borderRadius: radius.pill,
								backgroundColor: r.color,
							}}
						/>
					</View>
				))}
			</View>
			<View style={{ height: 1, backgroundColor: colors.border, marginVertical: spacing.lg }} />
			<View style={{ flexDirection: "row" }}>
				{rows.map((r) => (
					<View key={r.key} style={{ flex: 1, alignItems: "center", gap: spacing.xs, paddingHorizontal: 2 }}>
						{r.badge ? <BankLogo {...r.badge} size={40} /> : <Dot color={r.color} />}
						<Text variant="caption" numberOfLines={1} style={{ marginTop: spacing.xs }}>
							{r.label}
						</Text>
						<Text variant="bodyStrong" numberOfLines={1} adjustsFontSizeToFit>
							{r.value}
						</Text>
						<Text variant="caption" tone="secondary">
							{r.share}
						</Text>
					</View>
				))}
			</View>
		</View>
	);
}

/** Uma barra por linha, na mesma escala: o maior ocupa a largura toda. */
function HBarsView({ rows }: { rows: readonly GroupRow[] }) {
	const widths = barHeights(
		rows.map((r) => r.weight),
		100,
		3,
	);
	return (
		<View style={{ gap: spacing.lg }}>
			{rows.map((r, i) => (
				<View key={r.key} style={{ gap: spacing.sm }}>
					<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
						{r.badge ? <BankLogo {...r.badge} size={24} /> : <Dot color={r.color} />}
						<Text variant="body" numberOfLines={1} style={{ flex: 1 }}>
							{r.label}
						</Text>
						<Text variant="caption" tone="secondary">
							{r.share}
						</Text>
						<Text variant="bodyStrong" style={{ minWidth: 92, textAlign: "right" }}>
							{r.value}
						</Text>
					</View>
					<View style={{ height: layout.hbar, borderRadius: radius.pill, backgroundColor: colors.surface3 }}>
						<View
							style={{
								width: `${widths[i] ?? 0}%`,
								height: layout.hbar,
								borderRadius: radius.pill,
								backgroundColor: r.color,
							}}
						/>
					</View>
				</View>
			))}
		</View>
	);
}

/** Rosca com o total no meio e a lista embaixo (cor, nome, participação e valor). */
function DonutView({ rows, total }: { rows: readonly GroupRow[]; total: string }) {
	return (
		<>
			<View style={{ alignItems: "center" }}>
				<DonutChart segments={rows.map((r) => ({ key: r.key, color: r.color, weight: r.weight }))}>
					<View style={{ alignItems: "center", paddingHorizontal: spacing.xl + spacing.xs }}>
						<Text variant="numberMedium" adjustsFontSizeToFit numberOfLines={1}>
							{total}
						</Text>
						<Text variant="caption" tone="secondary" numberOfLines={1}>
							investidos
						</Text>
					</View>
				</DonutChart>
			</View>
			<View style={{ marginTop: spacing.lg, gap: spacing.md }}>
				{rows.map((r) => (
					<View
						key={r.key}
						style={{ flexDirection: "row", alignItems: "center", minHeight: 20, gap: spacing.md }}
					>
						<Dot color={r.color} />
						<Text variant="body" style={{ flex: 1 }} numberOfLines={1}>
							{r.label}
						</Text>
						<Text variant="caption" tone="secondary">
							{r.share}
						</Text>
						<Text variant="bodyStrong" style={{ minWidth: 92, textAlign: "right" }}>
							{r.value}
						</Text>
					</View>
				))}
			</View>
		</>
	);
}

/**
 * O gráfico de Classes ou de Instituições. Segurar o card abre "Ver como" (Barras, Barra horizontal, Rosca); quem
 * escolhe a forma é o dono e a escolha fica guardada. Os números vêm prontos da API.
 */
export function GroupsCard({
	title,
	rows,
	total,
	view,
	onViewChange,
}: {
	title: string;
	rows: readonly GroupRow[];
	total: string;
	view: ChartView;
	onViewChange: (view: ChartView) => void;
}) {
	const menu = useChartMenu();
	return (
		<>
			<View ref={menu.ref} collapsable={false}>
				<Card
					onLongPress={menu.show}
					longPressHint="Segure para escolher como ver o gráfico"
					label={`${groupsA11y(title, rows)}. Visto como ${CHART_VIEW_LABELS[view].toLowerCase()}`}
				>
					<Text
						variant="cardTitle"
						tone="secondary"
						accessibilityRole="header"
						style={{ marginBottom: spacing.lg }}
					>
						{title}
					</Text>
					{view === "bars" ? <BarsView rows={rows} /> : null}
					{view === "hbars" ? <HBarsView rows={rows} /> : null}
					{view === "donut" ? <DonutView rows={rows} total={total} /> : null}
				</Card>
			</View>
			<ChartMenu
				anchor={menu.anchor}
				viewport={menu.viewport}
				value={view}
				onPick={onViewChange}
				onClose={menu.close}
			/>
		</>
	);
}
