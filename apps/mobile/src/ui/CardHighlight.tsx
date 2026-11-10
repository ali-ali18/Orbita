import { colors, highlight, radius as radii } from "@orbita/tokens";
import { useId, useState } from "react";
import { type LayoutChangeEvent, StyleSheet, useWindowDimensions, View } from "react-native";
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from "react-native-svg";
import { type CardSize, highlightApplies, highlightGeometry, measuredSize } from "./highlight-geometry.ts";

const BLEED = highlight.bleed;

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
 * Duas camadas, de propósito:
 * - a de fora tem o tamanho exato do card e é quem mede (`onLayout` dispara de novo sempre que o card muda de tamanho:
 *   dados que chegam, valores escondidos, fonte do sistema);
 * - a de dentro, onde o SVG desenha, é `bleed` px MAIOR que o card em cada lado e o SVG ocupa 100% dela. A borda fica
 *   rente à aresta do card; quando a tela do SVG acabava exatamente ali, no Android a aresta de baixo dos cards altos
 *   saía cortada (a tela ficava cerca de 1 px de tela mais curta que o desenho). Com a folga, o fim da tela do SVG
 *   nunca encosta no traço.
 *
 * Estático por enquanto. Para animar depois: a geometria é uma função pura (`highlightGeometry`), então basta trocar
 * `LinearGradient` por uma versão animada do Reanimated e mover `x1/y1/x2/y2` (ou deslizar as paradas).
 */
export function CardHighlight({ radius = radii.card }: { radius?: number }) {
	const screen = useWindowDimensions();
	const [size, setSize] = useState<CardSize | null>(null);
	// Vários SVGs na mesma página (web) dividem os ids: cada card precisa dos seus.
	const id = useId().replace(/[^a-zA-Z0-9]/g, "");
	const onLayout = (event: LayoutChangeEvent) => {
		const { width, height } = event.nativeEvent.layout;
		setSize((prev) => measuredSize(prev, { width, height }));
	};
	const g =
		size && highlightApplies(size.width, screen.width, highlight.minWidthRatio)
			? highlightGeometry({ ...size, radius, ...highlight, bleed: BLEED })
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
			{g ? (
				<View style={{ position: "absolute", top: -BLEED, left: -BLEED, right: -BLEED, bottom: -BLEED }}>
					<Svg width="100%" height="100%">
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
						<Rect {...g.card} fill={`url(#${glow})`} />
						<Rect {...g.rect} fill="none" stroke={`url(#${stroke})`} strokeWidth={highlight.strokeWidth} />
					</Svg>
				</View>
			) : null}
		</View>
	);
}
