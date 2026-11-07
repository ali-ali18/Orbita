import { colors, radius, spacing } from "@orbita/tokens";
import { View } from "react-native";
import { money } from "../../lib/format.ts";
import { Text } from "../../ui/index.ts";
import { type CardLike, cardColor, type MonthColumn, monthAbbrev } from "./card-model.ts";
import { Dot } from "./parts.tsx";

const BAR_MAX = 150;
const BAR_MIN = 24;
const BAR_WIDTH = 36;

/**
 * Parcelas por mês, empilhadas por cartão (cor do banco). O mês de referência fica cheio e os seguintes
 * em 40%, como no Figma. A altura segue o maior mês; o valor exato vai no rótulo de acessibilidade.
 */
export function InstallmentsChart({
	columns,
	cards,
	hidden,
}: {
	columns: readonly MonthColumn[];
	cards: readonly CardLike[];
	hidden: boolean;
}) {
	const max = Math.max(1, ...columns.map((c) => c.totalCents));
	const used = cards.filter((c) => columns.some((col) => col.byCard.some((p) => p.cardId === c.id)));
	return (
		<View style={{ gap: spacing.md }}>
			<View style={{ flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, paddingTop: spacing.lg }}>
				{columns.map((col, i) => {
					const height =
						col.totalCents === 0 ? 0 : Math.max(BAR_MIN, Math.round((col.totalCents / max) * BAR_MAX));
					return (
						<View
							key={col.month}
							accessible
							accessibilityLabel={`${monthAbbrev(col.month)}: ${money(col.totalCents, hidden, { sign: "never" })}`}
							style={{ flex: 1, alignItems: "center", gap: 10 }}
						>
							<View
								style={{
									width: BAR_WIDTH,
									height,
									gap: 2,
									borderRadius: radius.pill,
									overflow: "hidden",
									opacity: i === 0 ? 1 : 0.4,
								}}
							>
								{col.byCard.map((p) => {
									const card = cards.find((c) => c.id === p.cardId);
									return (
										<View
											key={p.cardId}
											style={{ flex: p.cents, backgroundColor: card ? cardColor(card) : colors.surface3 }}
										/>
									);
								})}
							</View>
							<Text variant="micro" tone={i === 0 ? "primary" : "secondary"}>
								{monthAbbrev(col.month)}
							</Text>
						</View>
					);
				})}
			</View>
			<View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: spacing.lg, rowGap: spacing.xs }}>
				{used.map((c) => (
					<View key={c.id} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
						<Dot color={cardColor(c)} />
						<Text variant="caption" tone="secondary">
							{c.name}
						</Text>
					</View>
				))}
			</View>
		</View>
	);
}
