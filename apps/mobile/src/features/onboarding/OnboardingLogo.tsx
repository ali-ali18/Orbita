import { banks, radius } from "@orbita/tokens";
import { View } from "react-native";
import { SvgXml } from "react-native-svg";
import { BANK_SVGS, type OnboardingLogoId } from "./bank-svgs.ts";

/** Logo quadrado do banco, cortado em círculo. O Nubank fica branco sobre o roxo da marca. */
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
				backgroundColor: id === "nubank" ? banks.nubank : "transparent",
			}}
		>
			<SvgXml xml={BANK_SVGS[id]} width={size} height={size} />
		</View>
	);
}
