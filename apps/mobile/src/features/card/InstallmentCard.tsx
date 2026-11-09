import { colors, radius, spacing } from "@orbita/tokens";
import { View } from "react-native";
import { money } from "../../lib/format.ts";
import { BankLogo, Text } from "../../ui/index.ts";
import { bankBadge } from "../summary/summary-model.ts";
import { initialOf } from "../summary/transaction-model.ts";
import type { CardLike, InstallmentCardModel } from "./card-model.ts";

/** Um parcelamento: inicial da compra com o selo do banco, "n de N", barra, pago/falta (estimado quando for) e fim. */
export function InstallmentCard({
	model,
	card,
	hidden,
}: {
	model: InstallmentCardModel;
	card: CardLike | undefined;
	hidden: boolean;
}) {
	return (
		<View
			accessible
			accessibilityLabel={`${model.title}. ${model.progressLabel}. ${model.endLabel}`}
			style={{
				gap: 14,
				paddingTop: spacing.xl,
				paddingBottom: spacing.lg,
				paddingHorizontal: spacing.xl,
				borderRadius: radius.block,
				backgroundColor: colors.surface,
			}}
		>
			<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
				<View style={{ width: 44, height: 44 }}>
					<View
						style={{
							width: 44,
							height: 44,
							borderRadius: radius.pill,
							backgroundColor: colors.surface3,
							alignItems: "center",
							justifyContent: "center",
						}}
					>
						<Text variant="numberMedium">{initialOf(model.title)}</Text>
					</View>
					{card ? (
						<View style={{ position: "absolute", left: 26, top: 26 }}>
							<BankLogo {...bankBadge(card)} size={20} ring={colors.surface} />
						</View>
					) : null}
				</View>
				<View style={{ flex: 1, gap: 2 }}>
					<Text variant="bodyStrong" numberOfLines={1}>
						{model.title}
					</Text>
					<Text variant="caption" tone="secondary">
						{model.progressLabel}
					</Text>
				</View>
				<Text variant="bodyStrong">{money(model.currentCents, hidden, { sign: "never" })}</Text>
			</View>
			<View style={{ height: 6, borderRadius: 3, backgroundColor: colors.surface3, overflow: "hidden" }}>
				<View
					style={{
						width: `${Math.min(100, model.percent)}%`,
						height: 6,
						borderRadius: 3,
						backgroundColor: colors.accent,
					}}
				/>
			</View>
			<View style={{ flexDirection: "row" }}>
				<Text variant="caption" tone="secondary" style={{ flex: 1 }}>
					Pago {money(model.paidCents, hidden, { sign: "never" })}
					{model.paidEstimated ? " (estimado)" : ""}
				</Text>
				<Text variant="caption" tone="secondary">
					Falta {money(model.remainingCents, hidden, { sign: "never" })}
					{model.remainingEstimated ? " (estimado)" : ""}
				</Text>
			</View>
			<View style={{ height: 1, backgroundColor: colors.border }} />
			<Text variant="caption" tone="secondary">
				{model.endLabel}
			</Text>
		</View>
	);
}
