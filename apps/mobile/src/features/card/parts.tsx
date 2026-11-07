import { colors, radius, spacing } from "@orbita/tokens";
import type { ReactNode } from "react";
import { Pressable, ScrollView, type ScrollViewInstance, View } from "react-native";
import { BankLogo, Icon, Text } from "../../ui/index.ts";
import { initialOf } from "../summary/transaction-model.ts";
import { type CardLike, cardColor, cardLabel, cardSpokenName } from "./card-model.ts";

/** Número grande com rótulo em cima e legenda embaixo (topo de cada aba). */
export function BigNumber({ label, value, caption }: { label: string; value: string; caption?: string }) {
	return (
		<View style={{ gap: spacing.xs, paddingTop: spacing.xs }}>
			<Text variant="cardTitle" tone="secondary">
				{label}
			</Text>
			<Text variant="numberHero" adjustsFontSizeToFit numberOfLines={1}>
				{value}
			</Text>
			{caption ? (
				<Text variant="caption" tone="secondary">
					{caption}
				</Text>
			) : null}
		</View>
	);
}

/** Fileira que rola de ponta a ponta da tela (a tela tem margem de 16; o chip sangra por baixo dela). */
export function BleedRow({
	children,
	scrollRef,
}: {
	children: ReactNode;
	scrollRef?: React.Ref<ScrollViewInstance>;
}) {
	return (
		<ScrollView
			ref={scrollRef}
			horizontal
			showsHorizontalScrollIndicator={false}
			style={{ marginHorizontal: -spacing.lg, flexGrow: 0 }}
			contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}
		>
			{children}
		</ScrollView>
	);
}

/** Chip de cartão: logo de 24 + "•••• 3143". `null` em `card` é o "Todos". */
export function CardChip({
	card,
	selected,
	onPress,
	showName = false,
}: {
	card: CardLike | null;
	selected: boolean;
	onPress: () => void;
	/** Parcelas mostra o nome do banco no lugar dos 4 dígitos. */
	showName?: boolean;
}) {
	const label = card === null ? "Todos" : showName ? card.name : cardLabel(card);
	const filled = card === null && selected;
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={card === null ? "Todos os cartões" : cardSpokenName(card)}
			accessibilityState={{ selected }}
			onPress={onPress}
			style={{ minHeight: 44, justifyContent: "center" }}
		>
			<View
				style={{
					flexDirection: "row",
					alignItems: "center",
					gap: spacing.sm,
					paddingLeft: spacing.sm,
					paddingRight: 14,
					paddingVertical: spacing.sm,
					borderRadius: radius.pill,
					backgroundColor: filled ? colors.accent : selected ? colors.surface3 : colors.surface,
					borderWidth: showName && !filled ? 1 : 0,
					borderColor: colors.border,
				}}
			>
				{card === null ? (
					<Icon name="cartao" size={18} color={selected ? colors.onAccent : colors.text} />
				) : (
					<BankLogo initial={initialOf(card.name)} color={cardColor(card)} size={24} />
				)}
				<Text
					variant="bodyStrong"
					tone={filled ? "onAccent" : selected || showName ? "primary" : "secondary"}
					numberOfLines={1}
				>
					{label}
				</Text>
			</View>
		</Pressable>
	);
}

export function Dot({ color }: { color: string }) {
	return <View style={{ width: 8, height: 8, borderRadius: radius.pill, backgroundColor: color }} />;
}

/** Aviso do Figma: ícone de informação + frase curta em `surface`. */
export function Notice({ text }: { text: string }) {
	return (
		<View
			style={{
				flexDirection: "row",
				gap: 10,
				paddingHorizontal: spacing.lg,
				paddingVertical: spacing.md,
				borderRadius: radius.inner,
				backgroundColor: colors.surface,
			}}
		>
			<Icon name="info" size={18} color={colors.textSecondary} />
			<Text variant="caption" tone="secondary" style={{ flex: 1 }}>
				{text}
			</Text>
		</View>
	);
}
