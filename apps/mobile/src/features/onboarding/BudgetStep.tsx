import { colors, radius, spacing } from "@orbita/tokens";
import { useState } from "react";
import { View } from "react-native";
import { formatWholeReais } from "../../lib/format.ts";
import { Button, IconButton, OrbitaAvatar, Screen, Text } from "../../ui/index.ts";
import { SUGGESTED_AVERAGE_CENTS, SUGGESTED_TOTAL_CENTS, splitBudget, stepBudget } from "./model.ts";
import { ProgressHeader, SkipLink } from "./parts.tsx";

/** Orçamento (Figma 53:1139). `onDone` recebe o valor escolhido, ou null se pulou. */
export function BudgetStep({
	onBack,
	onDone,
}: {
	onBack: () => void;
	onDone: (cents: number | null) => void;
}) {
	const [cents, setCents] = useState(SUGGESTED_TOTAL_CENTS);
	const rows = splitBudget(cents);
	return (
		<Screen>
			<View style={{ flex: 1, paddingHorizontal: spacing.xl, paddingBottom: spacing.md, gap: spacing.lg }}>
				<ProgressHeader step={4} onBack={onBack} />
				<View style={{ gap: spacing.xs, paddingTop: spacing.xs }}>
					<Text variant="greeting" accessibilityRole="header">
						Quanto você quer gastar por mês?
					</Text>
					<Text variant="body" tone="secondary">
						Olhei seus últimos 3 meses no Nubank e no Inter.
					</Text>
				</View>
				<View style={{ alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm }}>
					<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.lg }}>
						<IconButton
							icon="menos"
							label="Diminuir"
							size={44}
							onPress={() => setCents((c) => stepBudget(c, -1))}
						/>
						<Text variant="numberHero">{formatWholeReais(cents)}</Text>
						<IconButton
							icon="mais"
							label="Aumentar"
							size={44}
							onPress={() => setCents((c) => stepBudget(c, 1))}
						/>
					</View>
					<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
						<OrbitaAvatar size={18} />
						<Text variant="caption" tone="secondary">
							Você gastou em média {formatWholeReais(SUGGESTED_AVERAGE_CENTS)}
						</Text>
					</View>
				</View>
				<View
					style={{
						backgroundColor: colors.surface,
						borderRadius: radius.block,
						padding: 18,
						gap: spacing.md,
					}}
				>
					<Text variant="caption" tone="secondary">
						Como eu dividiria
					</Text>
					<View style={{ flexDirection: "row", height: 10, gap: 2 }}>
						{rows.map((row) => (
							<View
								key={row.name}
								style={{ flex: row.cents, borderRadius: radius.pill, backgroundColor: row.color }}
							/>
						))}
					</View>
					{rows.map((row) => (
						<View key={row.name} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
							<View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: row.color }} />
							<Text variant="body" style={{ flex: 1 }}>
								{row.name}
							</Text>
							<Text variant="body">{formatWholeReais(row.cents)}</Text>
						</View>
					))}
				</View>
				<View style={{ flex: 1 }} />
				<Button label="Concluir" onPress={() => onDone(cents)} />
				<SkipLink label="Ajustar depois" onPress={() => onDone(null)} />
			</View>
		</Screen>
	);
}
