import { colors, radius, spacing } from "@orbita/tokens";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useAccent } from "../../lib/theme.tsx";
import { Icon, type IconName, Text } from "../../ui/index.ts";
import { categoryDot } from "./new-transaction-model.ts";

/** Bloco de linhas com divisória (Figma "grupo/itens"): fundo `surface`, raio `group`. */
export function DetailGroup({ children }: { children: ReactNode }) {
	return (
		<View style={{ backgroundColor: colors.surface, borderRadius: radius.group, overflow: "hidden" }}>
			{children}
		</View>
	);
}

/** Linha do grupo: rótulo à esquerda, valor à direita e, se abre uma escolha, a seta. Sem `onPress` só mostra. */
export function DetailRow({
	label,
	last = false,
	onPress,
	accessibilityValue,
	children,
}: {
	label: string;
	last?: boolean;
	onPress?: () => void;
	accessibilityValue: string;
	children: ReactNode;
}) {
	const body = (
		<View
			style={{
				flexDirection: "row",
				alignItems: "center",
				gap: spacing.md,
				minHeight: 51,
				paddingHorizontal: spacing.lg,
				paddingVertical: spacing.md,
				borderBottomWidth: last ? 0 : 1,
				borderBottomColor: colors.border,
			}}
		>
			<Text variant="body" style={{ flex: 1 }}>
				{label}
			</Text>
			{children}
			{onPress ? <Icon name="seta-direita" size={16} color={colors.textSecondary} /> : null}
		</View>
	);
	if (!onPress) {
		return (
			<View accessible accessibilityLabel={`${label}: ${accessibilityValue}`}>
				{body}
			</View>
		);
	}
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={`${label}: ${accessibilityValue}. Toque para mudar`}
			onPress={onPress}
			style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
		>
			{body}
		</Pressable>
	);
}

/** Valor em `textSecondary` de uma linha (Figma "Texto/Legenda"). */
export function RowValue({ children }: { children: string }) {
	return (
		<Text variant="caption" tone="secondary" numberOfLines={1} style={{ flexShrink: 1 }}>
			{children}
		</Text>
	);
}

/** Selo da categoria: bolinha na cor do gráfico + nome, em pílula `surface2`. */
export function CategoryPill({
	name,
	chartSlot,
	slug,
}: {
	name: string;
	chartSlot: number | null;
	slug?: string;
}) {
	return (
		<View
			style={{
				flexDirection: "row",
				alignItems: "center",
				gap: spacing.sm,
				paddingVertical: spacing.xs + 1,
				paddingLeft: spacing.sm + 2,
				paddingRight: spacing.md,
				borderRadius: radius.pill,
				backgroundColor: colors.surface2,
				flexShrink: 1,
			}}
		>
			<View
				style={{
					width: 8,
					height: 8,
					borderRadius: radius.pill,
					backgroundColor: categoryDot(chartSlot, slug),
				}}
			/>
			<Text variant="caption" numberOfLines={1} style={{ flexShrink: 1 }}>
				{name}
			</Text>
		</View>
	);
}

/** Linha do cartão "De onde veio": ícone, título, legenda e, à direita, a marca de "feito" ou um círculo vazio. */
export function OriginLine({
	icon,
	title,
	caption,
	done,
}: {
	icon: IconName;
	title: string;
	caption: string;
	done: boolean;
}) {
	const { accent, onAccent } = useAccent();
	return (
		<View
			accessible
			accessibilityLabel={`${title}. ${caption}`}
			style={{ flexDirection: "row", alignItems: "center", gap: spacing.md - 2 }}
		>
			<Icon name={icon} size={18} color={colors.textSecondary} />
			<View style={{ flex: 1 }}>
				<Text variant="body">{title}</Text>
				<Text variant="caption" tone="secondary">
					{caption}
				</Text>
			</View>
			<View
				style={{
					width: 18,
					height: 18,
					borderRadius: radius.pill,
					alignItems: "center",
					justifyContent: "center",
					backgroundColor: done ? accent : "transparent",
					borderWidth: done ? 0 : 1.5,
					borderColor: colors.textTertiary,
				}}
			>
				{done ? <Icon name="check" size={11} color={onAccent} /> : null}
			</View>
		</View>
	);
}
