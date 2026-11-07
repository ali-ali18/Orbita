import { colors, radius } from "@orbita/tokens";
import { Image, View } from "react-native";
import type { BankLogoKey } from "../lib/bank-logos.ts";
import { bankLogoAssets } from "./bank-logo-assets.ts";
import { Text } from "./Text.tsx";

/** O que identifica um banco no círculo: inicial e cor da marca (sempre) e o logo (quando o banco é conhecido). */
export interface BankBadge {
	initial: string;
	color: string;
	logo?: BankLogoKey | null | undefined;
}

/**
 * Círculo do banco. Com logo, mostra a imagem sobre fundo branco (os logos têm fundo transparente ou próprio, e
 * alguns são escuros); sem logo, a cor da marca com a inicial. `ring` desenha o anel de 2 que separa o selo do fundo.
 */
export function BankLogo({
	initial,
	color,
	logo,
	size = 32,
	ring,
}: BankBadge & {
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
				backgroundColor: logo ? colors.text : color,
				borderWidth: ring ? 2 : 0,
				borderColor: ring ?? colors.background,
				alignItems: "center",
				justifyContent: "center",
				overflow: "hidden",
			}}
		>
			{logo ? (
				<Image
					source={bankLogoAssets[logo]}
					accessibilityIgnoresInvertColors
					resizeMode="cover"
					style={{ width: "100%", height: "100%" }}
				/>
			) : (
				<Text variant={size < 24 ? "micro" : "bodyStrong"} tone="primary">
					{initial}
				</Text>
			)}
		</View>
	);
}
