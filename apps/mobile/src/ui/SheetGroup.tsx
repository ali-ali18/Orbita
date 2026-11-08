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

/** Linha de um `SheetGroup`: ícone (ou `leading`), texto, legenda e marca de escolhido à direita. */
export function SheetRow({
	icon,
	leading,
	label,
	caption,
	selected,
	role = "button",
	onPress,
}: {
	icon?: IconName;
	leading?: ReactNode;
	label: string;
	caption?: string | null | undefined;
	/** Quando definido, a linha é uma opção (radio) e mostra a marca se escolhida. */
	selected?: boolean;
	role?: "button" | "radio";
	onPress: () => void;
}) {
	const radio = selected !== undefined;
	return (
		<Pressable
			accessibilityRole={radio ? "radio" : role}
			accessibilityLabel={caption ? `${label}, ${caption}` : label}
			{...(radio ? { accessibilityState: { checked: selected } } : {})}
			onPress={onPress}
			style={({ pressed }) => ({
				minHeight: 56,
				flexDirection: "row",
				alignItems: "center",
				gap: spacing.md,
				paddingHorizontal: spacing.lg,
				opacity: pressed ? 0.8 : 1,
			})}
		>
			{leading ?? (icon ? <Icon name={icon} size={ICON} /> : null)}
			<View style={{ flex: 1 }}>
				<Text variant="body">{label}</Text>
				{caption ? (
					<Text variant="caption" tone="secondary">
						{caption}
					</Text>
				) : null}
			</View>
			{selected ? <Icon name="check" size={ICON} /> : null}
		</Pressable>
	);
}
