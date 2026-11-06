import { colors, radius } from "@orbita/tokens";
import { View } from "react-native";

export interface BarPart {
	key: string;
	color: string;
	/** Peso relativo (vira `flex`). */
	weight: number;
}

/**
 * Barra empilhada: cada parte ocupa uma fatia proporcional ao peso, com 2 de espaço entre elas
 * (styleguide). Sem partes, mostra só o trilho.
 */
export function ProgressBar({ parts, height = 8 }: { parts: readonly BarPart[]; height?: number }) {
	const visible = parts.filter((p) => p.weight > 0);
	return (
		<View
			accessibilityRole="progressbar"
			style={{ flexDirection: "row", height, gap: 2, borderRadius: radius.sm, overflow: "hidden" }}
		>
			{visible.length === 0 ? (
				<View style={{ flex: 1, backgroundColor: colors.surface3 }} />
			) : (
				visible.map((p) => <View key={p.key} style={{ flex: p.weight, backgroundColor: p.color }} />)
			)}
		</View>
	);
}
