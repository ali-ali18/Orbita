import { banks, colors, radius } from "@orbita/tokens";
import { View } from "react-native";
import { SvgXml } from "react-native-svg";
import { BANK_SVGS, type OnboardingLogoId } from "./bank-svgs.ts";

/** Cada ícone ocupa o círculo inteiro, com a cor da marca atrás do símbolo. */
const DISC: Record<OnboardingLogoId, string> = {
	nubank: banks.nubank,
	inter: banks.inter,
	santander: banks.santander,
	mercadopago: banks.mercadoPagoDisc,
	itau: banks.itauDisc,
	c6: colors.text,
	picpay: banks.picpay,
	bradesco: banks.bradescoDisc,
	"meu-pluggy": banks.pluggy,
};

/** Logo do banco em círculo preenchido com a cor da marca. */
export function OnboardingLogo({ id, size = 32 }: { id: OnboardingLogoId; size?: number }) {
	return (
		<View
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			style={{
				width: size,
				height: size,
				borderRadius: radius.pill,
				overflow: "hidden",
				backgroundColor: DISC[id],
			}}
		>
			<SvgXml xml={BANK_SVGS[id]} width={size} height={size} />
		</View>
	);
}
