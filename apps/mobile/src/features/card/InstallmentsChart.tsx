import { colors, radius, spacing } from "@orbita/tokens";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { money, monthName } from "../../lib/format.ts";
import { Text } from "../../ui/index.ts";
import { type CardLike, cardColor, type MonthColumn, monthAbbrev } from "./card-model.ts";
import { Dot } from "./parts.tsx";

const BAR_MAX = 150;
const BAR_MIN = 24;
const BAR_WIDTH = 36;

/**
 * Parcelas por mês, empilhadas por cartão (a mesma cor do logo). O mês de referência fica cheio e os
 * seguintes em 40%, como no Figma. Tocar numa coluna abre o valor daquele mês, por cartão.
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
	const [openMonth, setOpenMonth] = useState<string | null>(null);
	const max = Math.max(1, ...columns.map((c) => c.totalCents));
	const used = cards.filter((c) => columns.some((col) => col.byCard.some((p) => p.cardId === c.id)));
	const open = columns.find((col) => col.month === openMonth && col.totalCents > 0) ?? null;
	return (
		<View style={{ gap: spacing.md }}>
			<View style={{ flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, paddingTop: spacing.lg }}>
				{columns.map((col, i) => {
					const height =
						col.totalCents === 0 ? 0 : Math.max(BAR_MIN, Math.round((col.totalCents / max) * BAR_MAX));
					const expanded = open?.month === col.month;
					const label = `${monthAbbrev(col.month)}: ${money(col.totalCents, hidden, { sign: "never" })}`;
					return (
						<Pressable
							key={col.month}
							accessibilityRole="button"
							accessibilityLabel={expanded ? `${label}. Valor aberto` : label}
							accessibilityState={{ expanded }}
							disabled={col.totalCents === 0}
							onPress={() => setOpenMonth(expanded ? null : col.month)}
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
							<Text variant="micro" tone={expanded || i === 0 ? "primary" : "secondary"}>
								{monthAbbrev(col.month)}
							</Text>
						</Pressable>
					);
				})}
			</View>
			{open ? (
				<View
					style={{
						backgroundColor: colors.surface,
						borderRadius: radius.inner,
						paddingHorizontal: spacing.lg,
						paddingVertical: spacing.md,
						gap: spacing.sm,
					}}
				>
					<Text variant="caption" tone="secondary">
						{monthName(open.month)}
					</Text>
					{open.byCard.map((part) => {
						const card = cards.find((c) => c.id === part.cardId);
						return (
							<View key={part.cardId} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
								<Dot color={card ? cardColor(card) : colors.surface3} />
								<Text variant="body" style={{ flex: 1 }} numberOfLines={1}>
									{card?.name ?? "Cartão"}
								</Text>
								<Text variant="bodyStrong">{money(part.cents, hidden, { sign: "never" })}</Text>
							</View>
						);
					})}
				</View>
			) : null}
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
