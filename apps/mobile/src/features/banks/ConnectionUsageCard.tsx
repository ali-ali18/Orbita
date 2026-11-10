import { colors, radius, spacing } from "@orbita/tokens";
import { View } from "react-native";
import { ProgressBar, Text } from "../../ui/index.ts";
import { type ConnectionUsage, USAGE_FULL_HINT, USAGE_TITLE } from "./connect-model.ts";

/** "Conexões do plano gratuito 4 de 5" (Figma 43:663): quanto do limite do Meu Pluggy já está em uso. */
export function ConnectionUsageCard({ usage }: { usage: ConnectionUsage }) {
	const used = Math.min(usage.used, usage.limit);
	return (
		<View
			accessible
			accessibilityLabel={`${USAGE_TITLE}: ${usage.label}`}
			style={{
				backgroundColor: colors.surface,
				borderRadius: radius.group,
				padding: spacing.lg,
				gap: spacing.md,
			}}
		>
			<View style={{ flexDirection: "row", justifyContent: "space-between", gap: spacing.md }}>
				<Text variant="body" style={{ flex: 1 }}>
					{USAGE_TITLE}
				</Text>
				<Text variant="bodyStrong">{usage.label}</Text>
			</View>
			<ProgressBar
				height={6}
				parts={[
					{ key: "used", color: colors.text, weight: used },
					{ key: "free", color: colors.surface3, weight: usage.limit - used },
				]}
			/>
			{usage.full ? (
				<Text variant="caption" tone="secondary">
					{USAGE_FULL_HINT}
				</Text>
			) : null}
		</View>
	);
}
