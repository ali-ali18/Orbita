import { colors, layout, radius, spacing } from "@orbita/tokens";
import { Pressable, View } from "react-native";
import { useAccent } from "../../lib/theme.tsx";
import { BankLogo, Card, Icon, type LineSeries, Text } from "../../ui/index.ts";
import type { EvolutionChart, PositionRow, YieldCard, YieldEmpty } from "./investments-model.ts";

/** As linhas do gráfico: o aplicado tracejado (quebrado onde há buraco) e o patrimônio com a bolinha no último trecho. */
export function evolutionSeries(chart: EvolutionChart): LineSeries[] {
	return [
		...chart.investedRuns.map((points, i) => ({
			key: `invested-${i}`,
			points,
			color: colors.textTertiary,
			dashed: true,
		})),
		...chart.balanceRuns.map((points, i) => ({
			key: `balance-${i}`,
			points,
			color: colors.text,
			endDot: i === chart.balanceRuns.length - 1,
		})),
	];
}

/** "1 dia incompleto" / "N dias incompletos". */
export function incompleteDaysLabel(n: number): string {
	return n === 1 ? "1 dia sem todas as posições" : `${n} dias sem todas as posições`;
}

/**
 * Estado vazio de um número que não existe: ícone do app num disco discreto e UMA expressão curta, em cor secundária.
 * Nunca traço, nunca zero. `row` (cartões): ícone e texto lado a lado; `column` (gráficos): empilhados e centrados.
 */
export function EmptyNote({ empty, arrange = "row" }: { empty: YieldEmpty; arrange?: "row" | "column" }) {
	const column = arrange === "column";
	return (
		<View
			accessible
			accessibilityLabel={empty.title}
			style={{
				flexDirection: column ? "column" : "row",
				alignItems: "center",
				justifyContent: column ? "center" : "flex-start",
				gap: spacing.sm,
				flex: column ? undefined : 1,
			}}
		>
			<View
				style={{
					width: layout.emptyIconDisc,
					height: layout.emptyIconDisc,
					borderRadius: radius.pill,
					alignItems: "center",
					justifyContent: "center",
					backgroundColor: colors.surface2,
				}}
			>
				<Icon name={empty.icon} size={layout.emptyIcon} color={colors.textSecondary} />
			</View>
			<Text
				variant="caption"
				tone="secondary"
				numberOfLines={2}
				style={{ flexShrink: 1, textAlign: column ? "center" : "left" }}
			>
				{empty.title}
			</Text>
		</View>
	);
}

/** Cartão de meia largura: rótulo, valor e legenda; sem valor, o estado vazio desenhado; e o selo "estimado"/"parcial". */
export function YieldTile({ label, y }: { label: string; y: YieldCard }) {
	return (
		<Card style={{ flex: 1, padding: spacing.lg }}>
			<View accessible accessibilityLabel={y.a11y} style={{ gap: spacing.sm, flex: 1 }}>
				<Text variant="caption" tone="secondary" numberOfLines={1}>
					{label}
				</Text>
				{y.empty ? (
					<EmptyNote empty={y.empty} />
				) : (
					<View style={{ gap: spacing.xs }}>
						<Text variant="numberMedium" tone={y.tone} numberOfLines={1} adjustsFontSizeToFit>
							{y.value}
						</Text>
						<Text variant="caption" tone="secondary" numberOfLines={2}>
							{y.caption}
						</Text>
					</View>
				)}
				{y.note ? (
					<View
						style={{
							alignSelf: "flex-start",
							paddingHorizontal: spacing.sm,
							borderRadius: radius.pill,
							backgroundColor: colors.surface2,
						}}
					>
						<Text variant="micro" tone="secondary">
							{y.note}
						</Text>
					</View>
				) : null}
			</View>
		</Card>
	);
}

/** Abas em pílula (Classes · Instituições, 1 mês · 6 meses · 1 ano): a ativa na cor primária do tema. */
export function PillTabs<T extends string>({
	options,
	value,
	onChange,
}: {
	options: readonly { id: T; label: string }[];
	value: T;
	onChange: (next: T) => void;
}) {
	const { accent } = useAccent();
	return (
		<View accessibilityRole="tablist" style={{ flexDirection: "row", gap: spacing.sm }}>
			{options.map((o) => {
				const active = o.id === value;
				return (
					<Pressable
						key={o.id}
						accessibilityRole="tab"
						accessibilityLabel={o.label}
						accessibilityState={{ selected: active }}
						onPress={() => onChange(o.id)}
						style={{
							minHeight: layout.touchTarget,
							paddingHorizontal: spacing.lg,
							justifyContent: "center",
							borderRadius: radius.pill,
							backgroundColor: active ? accent : colors.surface,
						}}
					>
						<Text variant="bodyStrong" tone={active ? "onAccent" : "secondary"} numberOfLines={1}>
							{o.label}
						</Text>
					</Pressable>
				);
			})}
		</View>
	);
}

/** Linha de uma posição: marca do banco, nome, tipo e taxa, saldo e rendimento. */
export function PositionLine({ row, onPress }: { row: PositionRow; onPress: () => void }) {
	const y = row.yieldCard;
	const { accent } = useAccent();
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={`${row.title}, ${row.subtitle}, ${row.value}. ${y.a11y}${row.needsTerms ? ". A completar" : ""}`}
			onPress={onPress}
			style={({ pressed }) => ({
				flexDirection: "row",
				alignItems: "center",
				gap: spacing.md,
				minHeight: layout.positionRow,
				opacity: pressed ? 0.8 : 1,
			})}
		>
			<BankLogo {...row.badge} size={layout.touchTarget} />
			<View style={{ flex: 1 }}>
				<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
					<Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
						{row.title}
					</Text>
					{row.needsTerms ? (
						<View
							style={{
								width: layout.statusDot,
								height: layout.statusDot,
								borderRadius: radius.pill,
								backgroundColor: accent,
							}}
						/>
					) : null}
				</View>
				<Text variant="caption" tone="secondary" numberOfLines={1}>
					{row.subtitle}
				</Text>
			</View>
			<View style={{ alignItems: "flex-end", maxWidth: "42%" }}>
				<Text variant="bodyStrong" numberOfLines={1}>
					{row.value}
				</Text>
				<Text variant="caption" tone={y.value ? y.tone : "secondary"} numberOfLines={1}>
					{y.value ? `${y.value}${y.note ? " · est." : ""}` : (y.empty?.title ?? y.caption)}
				</Text>
			</View>
		</Pressable>
	);
}

export interface MiniTabsProps<T extends string> {
	options: readonly { id: T; label: string }[];
	value: T;
	onChange: (next: T) => void;
}

/**
 * Abas pequenas no cabeçalho de um card (estilo segmentado do card): a ativa em `surface3` com texto claro, as outras
 * só texto. A área de toque chega a 44 pelo `hitSlop`. Cor primária só em ação: aqui é seleção discreta dentro do card.
 */
export function MiniTabs<T extends string>({ options, value, onChange }: MiniTabsProps<T>) {
	return (
		<View
			accessibilityRole="tablist"
			style={{
				alignSelf: "flex-start",
				flexDirection: "row",
				padding: spacing.xs,
				borderRadius: radius.pill,
				backgroundColor: colors.surface2,
			}}
		>
			{options.map((o) => {
				const active = o.id === value;
				return (
					<Pressable
						key={o.id}
						accessibilityRole="tab"
						accessibilityLabel={o.label}
						accessibilityState={{ selected: active }}
						hitSlop={{ top: spacing.xs, bottom: spacing.xs }}
						onPress={() => onChange(o.id)}
						style={{
							minHeight: layout.miniTab,
							paddingHorizontal: spacing.md,
							justifyContent: "center",
							borderRadius: radius.pill,
							backgroundColor: active ? colors.surface3 : "transparent",
						}}
					>
						<Text variant="caption" tone={active ? "primary" : "secondary"} numberOfLines={1}>
							{o.label}
						</Text>
					</Pressable>
				);
			})}
		</View>
	);
}
