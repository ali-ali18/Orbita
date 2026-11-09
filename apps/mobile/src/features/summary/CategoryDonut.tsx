import { colors, radius, spacing } from "@orbita/tokens";
import { View } from "react-native";
import { money, percentOf } from "../../lib/format.ts";
import { DonutChart, Text } from "../../ui/index.ts";
import type { CategoryShare } from "./summary-model.ts";

/** Largura da coluna de valor no Figma (92 de 318); o percentual termina logo antes dela. */
const AMOUNT_WIDTH = 92;

/**
 * Gasto por categoria: rosca com o total no centro e, embaixo, uma linha por categoria com cor, %, e valor. A cor segue
 * a categoria (`chart.series`); o texto nunca usa a cor da série.
 */
export function CategoryDonut({ shares, hidden }: { shares: readonly CategoryShare[]; hidden: boolean }) {
	const total = shares.reduce((sum, s) => sum + s.cents, 0);
	const totalText = money(total, hidden, { sign: "never" });
	return (
		<>
			<View style={{ alignItems: "center" }}>
				<DonutChart
					segments={shares.map((s) => ({ key: s.key, color: s.color, weight: s.cents }))}
					label={`Gastos esse mês: ${totalText}, em ${shares.length === 1 ? "1 categoria" : `${shares.length} categorias`}`}
				>
					<View style={{ alignItems: "center", paddingHorizontal: spacing.xl + spacing.xs }}>
						<Text variant="numberMedium" adjustsFontSizeToFit numberOfLines={1}>
							{totalText}
						</Text>
						<Text variant="caption" tone="secondary" numberOfLines={1}>
							gastos esse mês
						</Text>
					</View>
				</DonutChart>
			</View>
			<View style={{ marginTop: spacing.lg, gap: spacing.md }}>
				{shares.map((s) => (
					<View key={s.key} style={{ flexDirection: "row", alignItems: "center", minHeight: 20 }}>
						<View
							style={{
								width: spacing.sm,
								height: spacing.sm,
								borderRadius: radius.pill,
								backgroundColor: s.color,
								marginRight: spacing.md,
							}}
						/>
						<Text variant="body" style={{ flex: 1 }} numberOfLines={1}>
							{s.name}
						</Text>
						<Text variant="caption" style={{ color: colors.textSecondary, marginRight: spacing.md }}>
							{percentOf(s.cents, total)}%
						</Text>
						<Text variant="bodyStrong" style={{ minWidth: AMOUNT_WIDTH, textAlign: "right" }}>
							{money(s.cents, hidden, { sign: "never" })}
						</Text>
					</View>
				))}
			</View>
		</>
	);
}
