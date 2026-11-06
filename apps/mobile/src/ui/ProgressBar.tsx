import { colors, radius } from "@orbita/tokens";
import { View } from "react-native";
import Svg, { Defs, Line, Pattern, Rect } from "react-native-svg";

export interface BarPart {
	key: string;
	color: string;
	/** Peso relativo (vira `flex`). */
	weight: number;
	/** Preenche com listras (ex.: contas a vencer), para não depender só da cor. */
	striped?: boolean;
}

const STRIPE = 6;

function Stripes({ background }: { background: string }) {
	return (
		<Svg width="100%" height="100%" accessibilityElementsHidden>
			<Defs>
				<Pattern
					id="stripes"
					width={STRIPE}
					height={STRIPE}
					patternUnits="userSpaceOnUse"
					patternTransform="rotate(45)"
				>
					<Line x1={0} y1={0} x2={0} y2={STRIPE} stroke={colors.textTertiary} strokeWidth={2} />
				</Pattern>
			</Defs>
			<Rect width="100%" height="100%" fill={background} />
			<Rect width="100%" height="100%" fill="url(#stripes)" />
		</Svg>
	);
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
				visible.map((p) => (
					<View key={p.key} style={{ flex: p.weight, backgroundColor: p.color, overflow: "hidden" }}>
						{p.striped ? <Stripes background={p.color} /> : null}
					</View>
				))
			)}
		</View>
	);
}
