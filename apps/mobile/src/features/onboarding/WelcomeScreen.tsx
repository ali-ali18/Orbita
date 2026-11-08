import { colors, radius, spacing } from "@orbita/tokens";
import { View } from "react-native";
import { Button, Icon, type IconName, OrbitaAvatar, Screen, Text } from "../../ui/index.ts";

const POINTS: readonly { icon: IconName; text: string }[] = [
	{ icon: "cadeado", text: "Seus dados ficam no seu servidor" },
	{ icon: "codigo", text: "Código aberto, sem mensalidade" },
	{ icon: "brilho", text: "Agentes que avisam antes do problema" },
];

/** Boas-vindas (Figma 52:1041). */
export function WelcomeScreen({ onStart }: { onStart: () => void }) {
	return (
		<Screen>
			<View style={{ flex: 1, paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl, gap: spacing.lg }}>
				<View style={{ flex: 1 }} />
				<View style={{ alignItems: "center", gap: 14 }}>
					<OrbitaAvatar size={120} />
					<View style={{ height: 10 }} />
					<Text variant="greeting" style={{ textAlign: "center" }}>
						Oi, eu sou a Órbita
					</Text>
					<Text variant="body" tone="secondary" style={{ textAlign: "center" }}>
						Vou organizar o seu dinheiro junto com você: gastos, cartões, faturas e avisos. Leva uns 3 minutos
						para começar.
					</Text>
				</View>
				<View style={{ flex: 1 }} />
				<View
					style={{
						backgroundColor: colors.surface,
						borderRadius: radius.block,
						padding: 18,
						gap: spacing.md,
					}}
				>
					{POINTS.map((point) => (
						<View key={point.text} style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
							<Icon name={point.icon} size={20} />
							<Text variant="body" style={{ flex: 1 }}>
								{point.text}
							</Text>
						</View>
					))}
				</View>
				<Button label="Começar" onPress={onStart} />
			</View>
		</Screen>
	);
}
