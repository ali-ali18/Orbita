import { colors, radius, spacing } from "@orbita/tokens";
import { View } from "react-native";
import { BankLogo, Icon, type IconName, Text } from "../../ui/index.ts";

const DISC = 64;
const BADGE = 24;

/** Topo do detalhe (Figma "resumo"): disco de 64 com o selo do banco, nome, valor grande e data. */
export function DetailSummary({
	icon,
	bank,
	title,
	amount,
	caption,
}: {
	icon: IconName;
	bank?: { initial: string; color: string } | undefined;
	title: string;
	amount: string;
	caption: string;
}) {
	return (
		<View
			style={{ alignItems: "center", gap: spacing.sm, paddingTop: spacing.xs, paddingBottom: spacing.sm }}
		>
			<View style={{ width: DISC, height: DISC, marginBottom: spacing.xs }}>
				<View
					style={{
						width: DISC,
						height: DISC,
						borderRadius: radius.pill,
						backgroundColor: colors.surface2,
						alignItems: "center",
						justifyContent: "center",
					}}
				>
					<Icon name={icon} size={28} />
				</View>
				{bank ? (
					<View style={{ position: "absolute", left: 42, top: 42 }}>
						<BankLogo initial={bank.initial} color={bank.color} size={BADGE} ring={colors.background} />
					</View>
				) : null}
			</View>
			<Text variant="bodyStrong" numberOfLines={2} style={{ textAlign: "center" }} accessibilityRole="header">
				{title}
			</Text>
			<Text
				variant="numberHero"
				accessibilityLabel={`Valor ${amount}`}
				adjustsFontSizeToFit
				numberOfLines={1}
			>
				{amount}
			</Text>
			<Text variant="caption" tone="secondary">
				{caption}
			</Text>
		</View>
	);
}
