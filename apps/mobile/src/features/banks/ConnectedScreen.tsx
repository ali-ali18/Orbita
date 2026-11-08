import type { PluggyConnectionDto } from "@orbita/shared";
import { colors, radius, spacing } from "@orbita/tokens";
import { Pressable, View } from "react-native";
import { BankLogo, Button, Icon, Screen, Text } from "../../ui/index.ts";
import { bankBadge } from "../summary/summary-model.ts";
import { bankColorByName, connectionName } from "./banks-model.ts";
import {
	CONNECTED_LATER,
	CONNECTED_SUBTITLE,
	connectedPrimary,
	connectedRows,
	connectedTitle,
} from "./connected-model.ts";

/** "Conectar banco · Pronto" (Figma 53:1254): o que o servidor trouxe do banco recém-conectado. */
export function ConnectedScreen({
	connection,
	imported,
	pending,
	onReview,
	onHome,
	onLater,
}: {
	connection: PluggyConnectionDto;
	imported: number | null;
	pending: number | null;
	onReview: () => void;
	onHome: () => void;
	onLater: () => void;
}) {
	const name = connectionName(connection);
	const rows = connectedRows({ summary: connection.summary, imported, pending });
	const primary = connectedPrimary(pending);
	return (
		<Screen>
			<View style={{ flex: 1, paddingHorizontal: spacing.xl, paddingBottom: spacing.xl }}>
				<View style={{ flex: 1, justifyContent: "center", gap: spacing.xl }}>
					<View style={{ alignItems: "center", gap: spacing.md }}>
						<View>
							<BankLogo {...bankBadge({ name })} color={bankColorByName(name)} size={72} />
							<View
								style={{
									position: "absolute",
									right: -8,
									bottom: -8,
									width: 32,
									height: 32,
									borderRadius: radius.pill,
									backgroundColor: colors.accent,
									borderWidth: 3,
									borderColor: colors.background,
									alignItems: "center",
									justifyContent: "center",
								}}
							>
								<Icon name="check" size={16} color={colors.onAccent} />
							</View>
						</View>
						<Text variant="greeting" style={{ textAlign: "center" }} accessibilityRole="header">
							{connectedTitle(connection)}
						</Text>
						<Text variant="body" tone="secondary" style={{ textAlign: "center" }}>
							{CONNECTED_SUBTITLE}
						</Text>
					</View>
					{rows.length > 0 ? (
						<View style={{ backgroundColor: colors.surface, borderRadius: radius.block }}>
							{rows.map((row, i) => (
								<View
									key={row.label}
									accessible
									accessibilityLabel={`${row.label}: ${row.value}`}
									style={{
										flexDirection: "row",
										alignItems: "center",
										justifyContent: "space-between",
										minHeight: 48,
										paddingHorizontal: spacing.lg,
										borderTopWidth: i === 0 ? 0 : 1,
										borderTopColor: colors.border,
									}}
								>
									<Text variant="body">{row.label}</Text>
									<Text variant="bodyStrong">{row.value}</Text>
								</View>
							))}
						</View>
					) : null}
				</View>
				<View style={{ gap: spacing.sm, alignItems: "center" }}>
					<Button
						label={primary.label}
						onPress={primary.target === "review" ? onReview : onHome}
						style={{ alignSelf: "stretch" }}
					/>
					<Pressable
						accessibilityRole="button"
						accessibilityLabel={CONNECTED_LATER}
						onPress={onLater}
						style={{ minHeight: 44, justifyContent: "center" }}
					>
						<Text variant="bodyStrong" tone="secondary">
							{CONNECTED_LATER}
						</Text>
					</Pressable>
				</View>
			</View>
		</Screen>
	);
}
