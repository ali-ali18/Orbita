import { banks, brandDiscs, colors, radius } from "@orbita/tokens";
import { View } from "react-native";
import Svg, { Path } from "react-native-svg";
import type { Brand } from "../lib/brands.ts";
import { BankLogo } from "./BankLogo.tsx";
import { brandGlyphs } from "./brand-glyphs.ts";
import { Icon, type IconName } from "./icons.tsx";

/**
 * Disco de uma loja ou serviço: o logo do banco, o glifo da marca sobre a cor dela ou, sem marca reconhecida (ou sem
 * glifo livre), o ícone. Sem marca o disco é `surface2` e o ícone é o da categoria; marca sem glifo (Amazon, Claro…)
 * mantém a cor da marca com um ícone genérico. Nunca mostra letra.
 */
export function StoreDisc({
	brand,
	icon,
	size = 44,
}: {
	brand?: Brand | null | undefined;
	/** Ícone da categoria, usado quando não há marca. */
	icon: IconName;
	size?: number;
}) {
	if (brand?.kind === "bank") {
		return <BankLogo initial="" color={banks.generic} logo={brand.logo} size={size} />;
	}
	const brandColors = brand ? brandDiscs[brand.id] : undefined;
	const glyph = brand ? brandGlyphs[brand.id] : undefined;
	const glyphColor = brandColors?.glyph ?? colors.text;
	return (
		<View
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			style={{
				width: size,
				height: size,
				borderRadius: radius.pill,
				backgroundColor: brandColors?.disc ?? colors.surface2,
				alignItems: "center",
				justifyContent: "center",
			}}
		>
			{glyph ? (
				<Svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill={glyphColor}>
					<Path d={glyph} />
				</Svg>
			) : (
				<Icon
					name={brand?.kind === "disc" ? brand.icon : icon}
					size={Math.round(size * 0.45)}
					color={glyphColor}
				/>
			)}
		</View>
	);
}
