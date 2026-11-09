import { colors, radius, spacing } from "@orbita/tokens";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import type { InstallmentsView } from "../../lib/api.ts";
import { money } from "../../lib/format.ts";
import type { Loadable } from "../../lib/loadable.ts";
import { Card, ErrorState, Icon, type IconName, Skeleton, Text } from "../../ui/index.ts";
import { installmentsOverview } from "./summary-model.ts";

/** Altura dos cards quadrados no Figma (173 de largura por 221 de altura). */
const SQUARE_MIN_HEIGHT = 221;

export function Frame({
	top,
	children,
	onPress,
	label,
}: {
	top: ReactNode;
	children: ReactNode;
	onPress?: (() => void) | undefined;
	label: string;
}) {
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={label}
			disabled={!onPress}
			onPress={onPress}
			style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.8 : 1 })}
		>
			<Card style={{ flex: 1, minHeight: SQUARE_MIN_HEIGHT, justifyContent: "space-between" }}>
				<View style={{ flexDirection: "row", alignItems: "flex-start" }}>
					<View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm }}>{top}</View>
					<Icon name="seta-direita" size={18} color={colors.textTertiary} />
				</View>
				<View>{children}</View>
			</Card>
		</Pressable>
	);
}

function Facts({ label, value, caption }: { label: string; value: string; caption: string }) {
	return (
		<>
			<Text variant="caption" tone="secondary">
				{label}
			</Text>
			<Text variant="numberMedium" adjustsFontSizeToFit numberOfLines={1}>
				{value}
			</Text>
			<Text variant="caption" tone="secondary">
				{caption}
			</Text>
		</>
	);
}

export function Placeholder({ label }: { label: string }) {
	return (
		<View accessibilityLabel={`${label}: carregando`} style={{ gap: spacing.sm }}>
			<Skeleton width="50%" height={14} />
			<Skeleton width="80%" height={22} />
			<Skeleton width="60%" height={14} />
		</View>
	);
}

function IconCircle({ name }: { name: IconName }) {
	return (
		<View
			style={{
				width: 44,
				height: 44,
				borderRadius: radius.pill,
				backgroundColor: colors.surface2,
				alignItems: "center",
				justifyContent: "center",
			}}
		>
			<Icon name={name} />
		</View>
	);
}

export function InstallmentsSquare({
	installments,
	month,
	hidden,
	onPress,
}: {
	onPress?: () => void;
	installments: Loadable<InstallmentsView>;
	month: string;
	hidden: boolean;
}) {
	const top = <IconCircle name="parcelas" />;
	if (installments.phase === "loading") {
		return (
			<Frame label="Parcelamentos, abrir o cartão" onPress={onPress} top={top}>
				<Placeholder label="Parcelamentos" />
			</Frame>
		);
	}
	if (installments.phase === "error") {
		return (
			<Frame label="Parcelamentos, abrir o cartão" onPress={onPress} top={top}>
				<ErrorState message={installments.message} onRetry={installments.retry} />
			</Frame>
		);
	}
	const { activeCount, monthlyCents } = installmentsOverview(installments.data.groups, month);
	return (
		<Frame label="Parcelamentos, abrir o cartão" onPress={onPress} top={top}>
			<Facts
				label="Parcelamentos"
				value={activeCount === 0 ? "Nenhum" : `${activeCount} ${activeCount === 1 ? "ativo" : "ativos"}`}
				caption={
					activeCount > 0
						? `${money(monthlyCents, hidden, { sign: "never" })} por mês`
						: "Nada parcelado agora"
				}
			/>
		</Frame>
	);
}
