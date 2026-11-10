import type { HomeWidgetSize } from "@orbita/shared";
import { colors } from "@orbita/tokens";
import { View } from "react-native";

const BOX = 18;
const HALF = 9;
/** Largura × altura do desenho de cada tamanho, dentro de uma caixa de 18: meia largura, faixa larga, bloco alto. */
const SHAPE: Record<HomeWidgetSize, { width: number; height: number }> = {
	"2x2": { width: HALF, height: HALF },
	"2x4": { width: BOX, height: HALF },
	"4x4": { width: BOX, height: BOX },
};

/** Miniatura de um tamanho de widget (2x2, 2x4, 4x4): a proporção que ele ocupa na grade. Só enfeite, sem rótulo. */
export function SizeGlyph({ size, color = colors.textSecondary }: { size: HomeWidgetSize; color?: string }) {
	return (
		<View
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			style={{ width: BOX, height: BOX, justifyContent: "center" }}
		>
			<View style={{ ...SHAPE[size], borderRadius: 3, borderWidth: 1.5, borderColor: color }} />
		</View>
	);
}
