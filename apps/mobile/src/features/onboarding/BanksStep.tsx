import { colors, radius, spacing } from "@orbita/tokens";
import { Pressable, ScrollView, View } from "react-native";
import { Button, Icon, Screen, Text } from "../../ui/index.ts";
import { type BankRow, connectionsUsedLabel, MEU_PLUGGY_NAME } from "./model.ts";
import { OnboardingLogo } from "./OnboardingLogo.tsx";
import { ProgressHeader, SkipLink } from "./parts.tsx";

/** Bancos (Figma 52:1109), com a conexão que o plano pessoal realmente abre: o Meu Pluggy. */
export function BanksStep({
	rows,
	onBack,
	onConnect,
	onContinue,
	onSkip,
	notice,
}: {
	rows: readonly BankRow[];
	onBack: () => void;
	onConnect: (name: string) => void;
	onContinue: () => void;
	onSkip: () => void;
	notice?: string | null;
}) {
	const used = rows.some((row) => row.name === MEU_PLUGGY_NAME && row.connected);
	return (
		<Screen>
			<View style={{ flex: 1, paddingHorizontal: spacing.xl, paddingBottom: spacing.md, gap: spacing.md }}>
				<ProgressHeader step={2} onBack={onBack} />
				<View style={{ gap: spacing.xs }}>
					<Text variant="greeting" accessibilityRole="header">
						Conecte seus bancos
					</Text>
					<Text variant="body" tone="secondary">
						O Meu Pluggy libera os seus bancos. Eu só leio: não consigo mover dinheiro.
					</Text>
				</View>
				<ScrollView
					style={{ flex: 1 }}
					contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}
					showsVerticalScrollIndicator={false}
				>
					<View style={{ backgroundColor: colors.surface, borderRadius: radius.block, overflow: "hidden" }}>
						{rows.map((row, index) => (
							<View
								key={row.name}
								style={{
									minHeight: 48,
									flexDirection: "row",
									alignItems: "center",
									gap: spacing.md,
									paddingHorizontal: 14,
									borderTopWidth: index === 0 ? 0 : 1,
									borderTopColor: colors.background,
								}}
							>
								<OnboardingLogo id={row.logo} />
								<Text variant="body" style={{ flex: 1 }} numberOfLines={1}>
									{row.name}
								</Text>
								{row.connected ? (
									<View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
										<Icon name="check" size={18} />
										<Text variant="caption">Conectado</Text>
									</View>
								) : row.connectable ? (
									<Pressable
										accessibilityRole="button"
										accessibilityLabel={`Conectar ${row.name}`}
										onPress={() => onConnect(row.name)}
										style={{
											height: 32,
											paddingHorizontal: 14,
											borderRadius: radius.pill,
											backgroundColor: colors.surface2,
											alignItems: "center",
											justifyContent: "center",
										}}
									>
										<Text variant="caption">Conectar</Text>
									</Pressable>
								) : null}
							</View>
						))}
					</View>
				</ScrollView>
				<Text variant="caption" tone="secondary">
					{connectionsUsedLabel(used)}
				</Text>
				{notice ? (
					<Text variant="caption" tone="secondary">
						{notice}
					</Text>
				) : null}
				<Button label="Continuar" onPress={onContinue} />
				<SkipLink label="Pular por agora" onPress={onSkip} />
			</View>
		</Screen>
	);
}
