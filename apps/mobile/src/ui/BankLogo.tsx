import { colors, radius } from "@orbita/tokens";
import { View } from "react-native";
import { Text } from "./Text.tsx";

/**
 * Círculo do banco. Ainda não há logos no app: mostra a cor da marca com a inicial, no tamanho e
 * na posição do Figma ("Banco/Logo"). `ring` desenha o anel de 2 que separa o selo do fundo.
 */
export function BankLogo({
	initial,
	color,
	size = 32,
	ring,
}: {
	initial: string;
	color: string;
	size?: number;
	/** Cor do anel de 2 (a do fundo atrás do selo). */
	ring?: string;
}) {
	return (
		<View
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			style={{
				width: size,
				height: size,
				borderRadius: radius.pill,
				backgroundColor: color,
				borderWidth: ring ? 2 : 0,
				borderColor: ring ?? colors.background,
				alignItems: "center",
				justifyContent: "center",
			}}
		>
			<Text variant={size < 24 ? "micro" : "bodyStrong"} tone="primary">
				{initial}
			</Text>
		</View>
	);
}
