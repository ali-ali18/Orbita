import { colors, highlight, radius } from "@orbita/tokens";
import { useId } from "react";
import { View } from "react-native";
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from "react-native-svg";
import { highlightGeometry } from "./highlight-geometry.ts";

/**
 * Borda de brilho e luz de canto do card de destaque. Sempre neutra (branco de `colors.text` em opacidades
 * decrescentes, o "prata"): não segue o tema, então não lê a cor primária. É só desenho: fica atrás do conteúdo,
 * não recebe toque e é invisível para o leitor de tela. SVG puro (`react-native-svg`, já no app), sem módulo nativo
 * novo, então chega por atualização OTA.
 *
 * Estático por enquanto. Para animar depois: a geometria é uma função pura (`highlightGeometry`), então basta trocar
 * `LinearGradient` por uma versão animada do Reanimated e girar `x1/y1/x2/y2` (ou deslizar as paradas).
 */
export function CardHighlight({ width, height }: { width: number; height: number }) {
	const tint = colors.text;
	// Vários SVGs na mesma página (web) dividem os ids: cada card precisa dos seus.
	const id = useId().replace(/[^a-zA-Z0-9]/g, "");
	const g = highlightGeometry({ width, height, radius: radius.card, ...highlight });
	if (!g) return null;
	const stroke = `hl-stroke-${id}`;
	const glow = `hl-glow-${id}`;
	return (
		<View
			accessible={false}
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			aria-hidden
			style={{ position: "absolute", top: 0, left: 0, width, height, pointerEvents: "none" }}
		>
			<Svg width={width} height={height}>
				<Defs>
					<LinearGradient id={stroke} gradientUnits="userSpaceOnUse" {...g.line}>
						{g.stops.map((s, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: paradas fixas, em ordem
							<Stop key={i} offset={s.offset} stopColor={tint} stopOpacity={s.opacity} />
						))}
					</LinearGradient>
					<RadialGradient
						id={glow}
						gradientUnits="userSpaceOnUse"
						cx={g.glow.cx}
						cy={g.glow.cy}
						fx={g.glow.cx}
						fy={g.glow.cy}
						r={g.glow.r}
					>
						<Stop offset={0} stopColor={tint} stopOpacity={g.glow.opacity} />
						<Stop offset={1} stopColor={tint} stopOpacity={0} />
					</RadialGradient>
				</Defs>
				<Rect x={0} y={0} width={width} height={height} rx={radius.card} fill={`url(#${glow})`} />
				<Rect {...g.rect} fill="none" stroke={`url(#${stroke})`} strokeWidth={highlight.strokeWidth} />
			</Svg>
		</View>
	);
}
