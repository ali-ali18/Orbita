import { colors, layout, spacing } from "@orbita/tokens";
import type { ReactNode } from "react";
import { View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { donutArcs } from "./chart-geometry.ts";

export interface DonutSegment {
	key: string;
	color: string;
	/** Peso relativo (a rosca divide a circunferência pela soma). */
	weight: number;
}

/**
 * Rosca com vários segmentos (começa no topo, sentido horário), pontas redondas e espaço `spacing.xs` entre eles.
 * Cor só no arco; o conteúdo do meio (total e rótulo) vai em `children`. Sem segmentos, mostra só o trilho.
 */
export function DonutChart({
	segments,
	size = layout.donut,
	stroke = layout.donutStroke,
	label,
	children,
}: {
	segments: readonly DonutSegment[];
	size?: number;
	stroke?: number;
	/** Frase para leitor de tela (a rosca sozinha não diz nada; a lista ao lado traz os valores). */
	label?: string;
	children?: ReactNode;
}) {
	const radius = (size - stroke) / 2;
	const circumference = 2 * Math.PI * radius;
	const mid = size / 2;
	const arcs = donutArcs(
		segments.map((s) => s.weight),
		radius,
		stroke,
		spacing.xs,
	);
	return (
		<View
			accessible={Boolean(label)}
			{...(label ? { accessibilityLabel: label, accessibilityRole: "image" as const } : {})}
			style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}
		>
			<Svg width={size} height={size} style={{ position: "absolute" }}>
				{arcs.length === 0 ? (
					<Circle cx={mid} cy={mid} r={radius} stroke={colors.surface3} strokeWidth={stroke} fill="none" />
				) : null}
				{arcs.map((arc) => {
					const segment = segments[arc.index];
					if (!segment) return null;
					return (
						<Circle
							key={segment.key}
							cx={mid}
							cy={mid}
							r={radius}
							stroke={segment.color}
							strokeWidth={stroke}
							fill="none"
							strokeLinecap={arcs.length === 1 ? "butt" : "round"}
							strokeDasharray={`${arc.length} ${circumference}`}
							strokeDashoffset={-arc.start}
							transform={`rotate(-90 ${mid} ${mid})`}
						/>
					);
				})}
			</Svg>
			{children}
		</View>
	);
}
