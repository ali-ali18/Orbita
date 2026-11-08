import { colors, spacing } from "@orbita/tokens";
import { View } from "react-native";
import { monthName } from "../../lib/format.ts";
import { Card, Icon, Text } from "../../ui/index.ts";

/** Atalho do Início para o Relatório do mês. */
export function ReportLink({ month, onPress }: { month: string; onPress: () => void }) {
	return (
		<Card onPress={onPress} label="Relatório do mês">
			<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
				<View style={{ flex: 1, gap: spacing.xs }}>
					<Text variant="cardTitle" tone="secondary" accessibilityRole="header">
						Relatório do mês
					</Text>
					<Text variant="caption" tone="tertiary">
						Como {monthName(month).toLocaleLowerCase("pt-BR")} fechou, contra o mês anterior
					</Text>
				</View>
				<Icon name="seta-direita" size={18} color={colors.textTertiary} />
			</View>
		</Card>
	);
}
