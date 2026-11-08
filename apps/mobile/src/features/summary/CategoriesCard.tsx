import { colors, radius, spacing } from "@orbita/tokens";
import { View } from "react-native";
import type { CategoriesView, MonthSummary } from "../../lib/api.ts";
import { money, percentOf } from "../../lib/format.ts";
import type { Loadable } from "../../lib/loadable.ts";
import { ProgressBar, Text } from "../../ui/index.ts";
import { LoadableCard } from "./LoadableCard.tsx";
import { categoryShares, shareSegments } from "./summary-model.ts";

/** Largura da coluna de valor no Figma (92 de 318); o percentual termina logo antes dela. */
const AMOUNT_WIDTH = 92;

export function CategoriesCard({
	state,
	hidden,
	onPress,
}: {
	state: Loadable<[MonthSummary, CategoriesView]>;
	hidden: boolean;
	onPress?: () => void;
}) {
	return (
		<LoadableCard
			title="Gastos por categoria"
			state={state}
			skeletonLines={4}
			chevron
			{...(onPress ? { onPress } : {})}
		>
			{([summary, { categories }]) => {
				const shares = categoryShares(summary.summary.byCategory, categories);
				const total = shares.reduce((sum, s) => sum + s.cents, 0);
				if (shares.length === 0) {
					return (
						<Text variant="body" tone="secondary">
							Nenhum gasto neste mês ainda.
						</Text>
					);
				}
				return (
					<>
						<ProgressBar parts={shareSegments(shares)} height={12} />
						<View style={{ marginTop: spacing.md, gap: spacing.md }}>
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
			}}
		</LoadableCard>
	);
}
