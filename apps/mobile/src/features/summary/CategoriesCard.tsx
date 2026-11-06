import { colors, radius, spacing } from "@orbita/tokens";
import { View } from "react-native";
import { money, percentOf } from "../../lib/format.ts";
import { Card, ProgressBar, Text } from "../../ui/index.ts";
import { type CategoryLike, categoryShares, shareSegments } from "./summary-model.ts";

export function CategoriesCard({
	byCategory,
	categories,
	hidden,
}: {
	byCategory: Readonly<Record<string, number>>;
	categories: readonly CategoryLike[];
	hidden: boolean;
}) {
	const shares = categoryShares(byCategory, categories);
	const total = shares.reduce((sum, s) => sum + s.cents, 0);
	return (
		<Card>
			<Text variant="cardTitle" tone="secondary">
				Gastos por categoria
			</Text>
			{shares.length === 0 ? (
				<Text variant="body" tone="secondary" style={{ marginTop: spacing.md }}>
					Nenhum gasto neste mês ainda.
				</Text>
			) : (
				<>
					<View style={{ marginTop: spacing.lg }}>
						<ProgressBar parts={shareSegments(shares)} height={12} />
					</View>
					<View style={{ marginTop: spacing.lg, gap: spacing.md }}>
						{shares.map((s) => (
							<View key={s.key} style={{ flexDirection: "row", alignItems: "center", minHeight: 20 }}>
								<View
									style={{
										width: 8,
										height: 8,
										borderRadius: radius.pill,
										backgroundColor: s.color,
										marginRight: spacing.sm + 2,
									}}
								/>
								<Text variant="body" style={{ flex: 1 }} numberOfLines={1}>
									{s.name}
								</Text>
								<Text variant="caption" style={{ color: colors.textSecondary, marginRight: spacing.md }}>
									{percentOf(s.cents, total)}%
								</Text>
								<Text variant="bodyStrong" style={{ minWidth: 92, textAlign: "right" }}>
									{money(s.cents, hidden, { sign: "never" })}
								</Text>
							</View>
						))}
					</View>
				</>
			)}
		</Card>
	);
}
