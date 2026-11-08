import type { PluggyConnectionDto } from "@orbita/shared";
import { colors, radius, spacing } from "@orbita/tokens";
import { View } from "react-native";
import { BankLogo, Button, Text } from "../../ui/index.ts";
import { bankBadge } from "../summary/summary-model.ts";
import { bankColorByName, connectionName, reconnectBannerText } from "./banks-model.ts";

/** "O Santander desconectou" (Figma 55:1204): aviso com contorno e o botão que reabre o Pluggy Connect. */
export function ReconnectBanner({
	connection,
	now,
	loading,
	onReconnect,
}: {
	connection: PluggyConnectionDto;
	now: Date;
	loading: boolean;
	onReconnect: () => void;
}) {
	const name = connectionName(connection);
	const text = reconnectBannerText(connection, now);
	return (
		<View
			accessibilityRole="alert"
			style={{
				backgroundColor: colors.surface,
				borderRadius: radius.block,
				borderWidth: 1,
				borderColor: colors.text,
				padding: spacing.lg,
				gap: spacing.md,
			}}
		>
			<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
				<BankLogo {...bankBadge({ name })} color={bankColorByName(name)} size={40} />
				<View style={{ flex: 1 }}>
					<Text variant="bodyStrong">{text.title}</Text>
					<Text variant="caption" tone="secondary">
						{text.caption}
					</Text>
				</View>
			</View>
			<Text variant="caption" tone="secondary">
				{text.body}
			</Text>
			<Button label={text.button} loading={loading} onPress={onReconnect} />
		</View>
	);
}
