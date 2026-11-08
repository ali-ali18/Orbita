import { colors, radius, spacing } from "@orbita/tokens";
import { Pressable, View } from "react-native";
import { type BankBadge, BankLogo, LetterAvatar, Text } from "../../ui/index.ts";
import type { MonthStatus } from "./subscriptions-model.ts";

/** Selo do banco no canto do círculo (Figma "Banco/Logo", 20 em (30, 30) de um círculo de 48). */
const BADGE = 20;
const BADGE_OFFSET = 30;
const LOGO = 48;

/**
 * Linha da lista (Figma 28:488): círculo com a inicial e o selo da conta/cartão, nome, "Todo dia 12 · em 6 dias" e valor.
 * Pendente ganha só um ponto discreto ao lado do nome (lançar é no card do topo ou na edição). Tocar na linha abre a edição.
 */
export function SubscriptionRow({
	name,
	caption,
	value,
	status,
	bank,
	onPress,
}: {
	name: string;
	caption: string;
	/** Já formatado (ou escondido pelo olho). */
	value: string;
	status: MonthStatus;
	bank?: BankBadge | undefined;
	onPress: () => void;
}) {
	const pending = status === "pending";
	return (
		<View>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={`${name}, ${caption}${pending && !caption.includes("pendente") ? ", pendente" : ""}, ${value}. Editar`}
				onPress={onPress}
				style={({ pressed }) => ({
					flexDirection: "row",
					alignItems: "center",
					gap: spacing.md + 2,
					paddingVertical: spacing.sm,
					minHeight: 64,
					opacity: pressed ? 0.8 : 1,
				})}
			>
				<View style={{ width: LOGO, height: LOGO }}>
					<LetterAvatar letter={name.trim().charAt(0).toLocaleUpperCase("pt-BR") || "·"} size={LOGO} />
					{bank ? (
						<View style={{ position: "absolute", left: BADGE_OFFSET, top: BADGE_OFFSET }}>
							<BankLogo {...bank} size={BADGE} ring={colors.background} />
						</View>
					) : null}
				</View>
				<View style={{ flex: 1, gap: 2 }}>
					<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
						<Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
							{name}
						</Text>
						{pending ? (
							<View
								accessibilityElementsHidden
								importantForAccessibility="no-hide-descendants"
								style={{
									width: 6,
									height: 6,
									borderRadius: radius.pill,
									backgroundColor: colors.textSecondary,
								}}
							/>
						) : null}
					</View>
					<Text variant="caption" tone="secondary" numberOfLines={1}>
						{caption}
					</Text>
				</View>
				<Text variant="bodyStrong">{value}</Text>
			</Pressable>
		</View>
	);
}
