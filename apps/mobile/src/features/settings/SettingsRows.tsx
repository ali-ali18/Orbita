import { colors, layout, radius, spacing } from "@orbita/tokens";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { Icon, type IconName, Text } from "../../ui/index.ts";

/**
 * Seção do Figma: legenda em `textSecondary` (se houver `title`) e, embaixo, um bloco `surface` com as
 * linhas (raio `group`). Sem `title` é só o bloco, para telas em que o nome já aparece em outro campo.
 */
export function SettingsSection({ title, children }: { title?: string; children: ReactNode }) {
	return (
		<View style={{ gap: spacing.sm, paddingTop: spacing.sm }}>
			{title ? (
				<Text variant="caption" tone="secondary" accessibilityRole="header">
					{title}
				</Text>
			) : null}
			<View
				style={{
					backgroundColor: colors.surface,
					borderRadius: radius.group,
					overflow: "hidden",
				}}
			>
				{children}
			</View>
		</View>
	);
}

/**
 * Linha de lista: ícone de 20, título, valor à direita e seta. Sem `onPress` fica desativada (item
 * que ainda não tem tela): aparece como no Figma, esmaecida, e o leitor de tela a lê como desativada.
 */
export function SettingsRow({
	icon,
	leading,
	title,
	caption,
	value,
	onPress,
	last = false,
	chevron = true,
	info = false,
	trailing,
	soon = false,
	toggled,
}: {
	icon?: IconName;
	leading?: ReactNode;
	title: string;
	caption?: string | null | undefined;
	value?: string | undefined;
	onPress?: (() => void) | undefined;
	last?: boolean;
	chevron?: boolean;
	/** Linha só de leitura (aparelho, data): sem toque, sem seta e sem esmaecer. */
	info?: boolean;
	/** Elemento no lugar do valor e da seta (o interruptor de Segurança). */
	trailing?: ReactNode;
	/** Ainda sem tela: mostra "Em breve", esmaecida e sem toque (sem seta). */
	soon?: boolean;
	/** Linha que é um interruptor: o leitor de tela a lê como "ligado/desligado" em vez de botão. */
	toggled?: boolean | undefined;
}) {
	const enabled = onPress !== undefined;
	const rowStyle = {
		flexDirection: "row" as const,
		alignItems: "center" as const,
		gap: spacing.lg,
		minHeight: layout.touchTarget,
		paddingHorizontal: spacing.lg,
		paddingVertical: caption ? spacing.md : spacing.lg,
		borderBottomWidth: last ? 0 : 1,
		borderBottomColor: colors.border,
	};
	if (info) {
		return (
			<View accessible accessibilityLabel={[title, value].filter(Boolean).join(", ")} style={rowStyle}>
				<Text variant="body" style={{ flex: 1 }}>
					{title}
				</Text>
				{value ? (
					<Text
						variant="caption"
						tone="secondary"
						numberOfLines={1}
						style={{ flexShrink: 1, maxWidth: "60%" }}
					>
						{value}
					</Text>
				) : null}
			</View>
		);
	}
	return (
		<Pressable
			accessibilityRole={toggled === undefined ? "button" : "switch"}
			accessibilityLabel={[title, caption, value, soon ? "em breve" : undefined].filter(Boolean).join(", ")}
			accessibilityState={
				toggled === undefined ? { disabled: !enabled } : { disabled: !enabled, checked: toggled }
			}
			disabled={!enabled}
			onPress={onPress}
			style={({ pressed }) => ({ ...rowStyle, opacity: !enabled ? 0.45 : pressed ? 0.8 : 1 })}
		>
			{leading ?? (icon ? <Icon name={icon} size={20} /> : null)}
			<View style={{ flex: 1 }}>
				<Text variant="body">{title}</Text>
				{caption ? (
					<Text variant="caption" tone="secondary">
						{caption}
					</Text>
				) : null}
			</View>
			{value ? (
				<Text variant="caption" tone="secondary" numberOfLines={1} style={{ flexShrink: 1, maxWidth: "45%" }}>
					{value}
				</Text>
			) : null}
			{soon ? (
				<Text variant="caption" tone="tertiary">
					Em breve
				</Text>
			) : null}
			{trailing}
			{chevron && !soon ? <Icon name="seta-direita" size={16} color={colors.textSecondary} /> : null}
		</Pressable>
	);
}

/** Interruptor (46 × 28) só de desenho: o toque é da linha que o contém. */
export function StaticSwitch({ on }: { on: boolean }) {
	return (
		<View
			style={{
				width: spacing.xxxl + spacing.lg,
				height: spacing.xxl + spacing.xs,
				borderRadius: radius.pill,
				backgroundColor: on ? colors.accent : colors.surface3,
				padding: spacing.xs,
				alignItems: on ? "flex-end" : "flex-start",
			}}
		>
			<View
				style={{
					width: spacing.xl,
					height: spacing.xl,
					borderRadius: radius.pill,
					backgroundColor: on ? colors.onAccent : colors.textSecondary,
				}}
			/>
		</View>
	);
}
