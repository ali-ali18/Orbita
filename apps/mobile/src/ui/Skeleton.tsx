import { colors, radius } from "@orbita/tokens";
import { type DimensionValue, View } from "react-native";

/** Bloco cinza no lugar de um texto ou valor que ainda está carregando. */
export function Skeleton({ width = "100%", height = 16 }: { width?: DimensionValue; height?: number }) {
	return (
		<View
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			style={{ width, height, borderRadius: radius.sm, backgroundColor: colors.surface2 }}
		/>
	);
}
