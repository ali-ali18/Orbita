import { colors } from "@orbita/tokens";
import { useState } from "react";
import { View } from "react-native";
import Svg, { Circle, G, Line, Path } from "react-native-svg";
import { type ChartPoint, linePath, project } from "./chart-geometry.ts";

export interface LineSeries {
	key: string;
	points: readonly ChartPoint[];
	color: string;
	/** Linha tracejada (período de comparação). */
	dashed?: boolean;
	/** Bolinha no último ponto (o "hoje"). */
	endDot?: boolean;
}

/**
 * Gráfico de linhas sem texto nos eixos: uma ou mais séries na mesma escala (`xMax`, `yMax`). Quem usa escolhe o
 * domínio; este componente só desenha, com uma linha de chão no fundo.
 */
export function LineChart({
	series,
	xMax,
	yMax,
	height = 160,
	pad = 6,
	label,
}: {
	series: readonly LineSeries[];
	xMax: number;
	yMax: number;
	height?: number;
	pad?: number;
	label?: string;
}) {
	const [width, setWidth] = useState(0);
	const box = { width, height, pad };
	const domain = { xMax, yMax };
	return (
		<View
			accessible={Boolean(label)}
			{...(label ? { accessibilityLabel: label, accessibilityRole: "image" as const } : {})}
			onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}
			style={{ height, alignSelf: "stretch" }}
		>
			{width > 0 ? (
				<Svg width={width} height={height}>
					<Line
						x1={pad}
						x2={width - pad}
						y1={height - pad}
						y2={height - pad}
						stroke={colors.border}
						strokeWidth={1}
					/>
					{series.map((s) => {
						const last = s.points.at(-1);
						const dot = s.endDot && last ? project(last, box, domain) : null;
						return (
							<G key={s.key}>
								<Path
									d={linePath(s.points, box, domain)}
									stroke={s.color}
									strokeWidth={2}
									fill="none"
									strokeLinecap="round"
									strokeLinejoin="round"
									{...(s.dashed ? { strokeDasharray: "5 5" } : {})}
								/>
								{dot ? <Circle cx={dot.x} cy={dot.y} r={4} fill={s.color} /> : null}
							</G>
						);
					})}
				</Svg>
			) : null}
		</View>
	);
}
