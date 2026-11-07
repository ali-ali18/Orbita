import { colors, radius, spacing } from "@orbita/tokens";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { Text } from "./Text.tsx";

/** Linha de lista: ícone/avatar à esquerda, título + legenda, valor à direita (com legenda opcional). */
export function ListRow({
	leading,
	title,
	caption,
	value,
	valueCaption,
	badge,
	onPress,
}: {
	leading?: ReactNode;
	title: string;
	caption?: string;
	value?: string;
	valueCaption?: string;
	/** Selo pequeno embaixo do valor (ex.: "Pendente"). */
	badge?: string;
	/** Torna a linha um botão (abre o detalhe). */
	onPress?: () => void;
}) {
	const row = (
		<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 64 }}>
			{leading}
			<View style={{ flex: 1 }}>
				<Text variant="bodyStrong" numberOfLines={1}>
					{title}
				</Text>
				{caption ? (
					<Text variant="caption" tone="secondary" numberOfLines={1}>
						{caption}
					</Text>
				) : null}
			</View>
			{value ? (
				<View style={{ alignItems: "flex-end" }}>
					<Text variant="bodyStrong">{value}</Text>
					{badge ? (
						<View
							style={{
								marginTop: spacing.xs,
								paddingHorizontal: spacing.sm,
								paddingVertical: 1,
								borderRadius: radius.pill,
								backgroundColor: colors.surface3,
							}}
						>
							<Text variant="micro" tone="secondary">
								{badge}
							</Text>
						</View>
					) : null}
					{valueCaption ? (
						<Text variant="caption" tone="secondary">
							{valueCaption}
						</Text>
					) : null}
				</View>
			) : null}
		</View>
	);
	if (!onPress) return row;
	const spoken = [title, caption, value, badge, valueCaption].filter(Boolean).join(", ");
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={spoken}
			onPress={onPress}
			style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
		>
			{row}
		</Pressable>
	);
}
