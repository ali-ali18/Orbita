import { colors, radius, spacing } from "@orbita/tokens";
import { Children, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { Icon, type IconName } from "./icons.tsx";
import { Text } from "./Text.tsx";

const ICON = 20;
/** Onde a divisória começa: depois do padding da linha, do ícone e do espaço até o texto. */
const DIVIDER_INSET = spacing.lg + ICON + spacing.md;

/** Cartão arredondado da gaveta: linhas juntas, com divisória fina (recuada à esquerda) entre elas. */
export function SheetGroup({ children, gap = true }: { children: ReactNode; gap?: boolean }) {
	const rows = Children.toArray(children);
	return (
		<View
			style={{
				backgroundColor: colors.surface2,
				borderRadius: radius.group,
				overflow: "hidden",
				marginBottom: gap ? spacing.md : 0,
			}}
		>
			{rows.map((row, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: linhas estáticas do grupo
				<View key={i}>
					{i > 0 ? (
						<View style={{ height: 1, marginLeft: DIVIDER_INSET, backgroundColor: colors.border }} />
					) : null}
					{row}
				</View>
			))}
		</View>
	);
}

/**
 * Linha de um `SheetGroup`: ícone (ou `leading`), texto, legenda e marca de escolhido à direita.
 * `variant="detailed"` é a opção com descrição longa (modelo de IA): mais respiro em cima e embaixo, a legenda quebra
 * em quantas linhas precisar e `note` (ex.: o preço) fica numa linha própria, em tom terciário.
 */
export function SheetRow({
	icon,
	leading,
	label,
	caption,
	note,
	selected,
	role = "button",
	variant = "default",
	onPress,
}: {
	icon?: IconName;
	leading?: ReactNode;
	label: string;
	caption?: string | null | undefined;
	/** Só no `detailed`: linha extra abaixo da legenda, em tom terciário. */
	note?: string | null | undefined;
	/** Quando definido, a linha é uma opção (radio) e mostra a marca se escolhida. */
	selected?: boolean;
	role?: "button" | "radio";
	variant?: "default" | "detailed";
	onPress: () => void;
}) {
	const radio = selected !== undefined;
	const detailed = variant === "detailed";
	const spoken = [label, caption, detailed ? note : null].filter(Boolean).join(", ");
	return (
		<Pressable
			accessibilityRole={radio ? "radio" : role}
			accessibilityLabel={spoken}
			{...(radio ? { accessibilityState: { checked: selected } } : {})}
			onPress={onPress}
			style={({ pressed }) => ({
				minHeight: 56,
				flexDirection: "row",
				alignItems: "center",
				gap: spacing.md,
				paddingHorizontal: spacing.lg,
				paddingVertical: detailed ? spacing.lg : spacing.md,
				opacity: pressed ? 0.8 : 1,
			})}
		>
			{leading ?? (icon ? <Icon name={icon} size={ICON} /> : null)}
			<View style={{ flex: 1, gap: detailed ? spacing.xs : 0 }}>
				<Text variant={detailed ? "bodyStrong" : "body"}>{label}</Text>
				{caption ? (
					<Text variant="caption" tone="secondary">
						{caption}
					</Text>
				) : null}
				{detailed && note ? (
					<Text variant="caption" tone="tertiary">
						{note}
					</Text>
				) : null}
			</View>
			{selected ? <Icon name="check" size={ICON} /> : null}
		</Pressable>
	);
}
