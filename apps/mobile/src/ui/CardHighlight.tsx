import { colors, highlight, radius as radii } from "@orbita/tokens";
import { useId, useState } from "react";
import { type LayoutChangeEvent, StyleSheet, useWindowDimensions, View } from "react-native";
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from "react-native-svg";
import { highlightApplies, highlightGeometry } from "./highlight-geometry.ts";

/**
 * Borda de brilho e luz de canto do card de largura cheia. Sempre neutra (branco de `colors.text` em opacidades
 * decrescentes, o "prata"): não segue o tema, então não lê a cor primária. É só desenho: fica atrás do conteúdo,
 * não recebe toque e é invisível para o leitor de tela. SVG puro (`react-native-svg`, já no app), sem módulo nativo
 * novo, então chega por atualização OTA.
 *
 * Preenche o pai (posição absoluta) e mede a si mesmo, então serve a qualquer superfície: o `Card` já a inclui, e um
 * bloco que não é `Card` põe `<CardHighlight radius={…} />` como primeiro filho. Card de meia largura (widget 2x2)
 * não desenha nada: a regra é pela largura medida (`highlight.minWidthRatio`), não por prop em cada tela.
 *
 * Estático por enquanto. Para animar depois: a geometria é uma função pura (`highlightGeometry`), então basta trocar
 * `LinearGradient` por uma versão animada do Reanimated e girar `x1/y1/x2/y2` (ou deslizar as paradas).
 */
export function CardHighlight({ radius = radii.card }: { radius?: number }) {
	const screen = useWindowDimensions();
	const [size, setSize] = useState<{ width: number; height: number } | null>(null);
	// Vários SVGs na mesma página (web) dividem os ids: cada card precisa dos seus.
	const id = useId().replace(/[^a-zA-Z0-9]/g, "");
	const onLayout = (event: LayoutChangeEvent) => {
		const { width, height } = event.nativeEvent.layout;
		setSize((prev) => (prev?.width === width && prev.height === height ? prev : { width, height }));
	};
	const g =
		size && highlightApplies(size.width, screen.width, highlight.minWidthRatio)
			? highlightGeometry({ ...size, radius, ...highlight })
			: null;
	const stroke = `hl-stroke-${id}`;
	const glow = `hl-glow-${id}`;
	return (
		<View
			accessible={false}
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			aria-hidden
			onLayout={onLayout}
			style={[StyleSheet.absoluteFill, { pointerEvents: "none" }]}
		>
			{g && size ? (
				<Svg width={size.width} height={size.height}>
					<Defs>
						<LinearGradient id={stroke} gradientUnits="userSpaceOnUse" {...g.line}>
							{g.stops.map((s, i) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: paradas fixas, em ordem
								<Stop key={i} offset={s.offset} stopColor={colors.text} stopOpacity={s.opacity} />
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
							<Stop offset={0} stopColor={colors.text} stopOpacity={g.glow.opacity} />
							<Stop offset={1} stopColor={colors.text} stopOpacity={0} />
						</RadialGradient>
					</Defs>
					<Rect x={0} y={0} width={size.width} height={size.height} rx={radius} fill={`url(#${glow})`} />
					<Rect {...g.rect} fill="none" stroke={`url(#${stroke})`} strokeWidth={highlight.strokeWidth} />
				</Svg>
			) : null}
		</View>
	);
}
