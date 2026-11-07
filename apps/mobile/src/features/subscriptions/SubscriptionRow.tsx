import { colors, radius, spacing } from "@orbita/tokens";
import { Pressable, View } from "react-native";
import { BankLogo, Button, LetterAvatar, Text } from "../../ui/index.ts";
import type { MonthStatus } from "./subscriptions-model.ts";

/** Selo do banco no canto do círculo (Figma "Banco/Logo", 20 em (30, 30) de um círculo de 48). */
const BADGE = 20;
const BADGE_OFFSET = 30;
const LOGO = 48;

/**
 * Linha da lista (Figma 28:488): círculo com a inicial e o selo da conta/cartão, nome, "Todo dia 12 · em 6 dias" e valor.
 * Pendente ganha o botão "Lançar agora" embaixo do texto. Tocar na linha abre a edição.
 */
export function SubscriptionRow({
	name,
	caption,
	value,
	status,
	bank,
	posting,
	onPress,
	onPostNow,
}: {
	name: string;
	caption: string;
	/** Já formatado (ou escondido pelo olho). */
	value: string;
	status: MonthStatus;
	bank?: { initial: string; color: string } | undefined;
	posting: boolean;
	onPress: () => void;
	onPostNow: () => void;
}) {
	return (
		<View style={{ gap: spacing.sm }}>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={`${name}, ${caption}, ${value}. Editar`}
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
							<BankLogo initial={bank.initial} color={bank.color} size={BADGE} ring={colors.background} />
						</View>
					) : null}
				</View>
				<View style={{ flex: 1, gap: 2 }}>
					<Text variant="bodyStrong" numberOfLines={1}>
						{name}
					</Text>
					<Text variant="caption" tone="secondary" numberOfLines={1}>
						{caption}
					</Text>
				</View>
				<Text variant="bodyStrong">{value}</Text>
			</Pressable>
			{status === "pending" ? (
				<View
					style={{
						alignSelf: "flex-start",
						marginLeft: LOGO + spacing.md + 2,
						borderRadius: radius.pill,
						overflow: "hidden",
					}}
				>
					<Button label="Lançar agora" variant="secondary" compact loading={posting} onPress={onPostNow} />
				</View>
			) : null}
		</View>
	);
}
