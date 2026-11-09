import { colors } from "@orbita/tokens";
import type { ReactNode } from "react";
import { View } from "react-native";
import Svg, { Circle } from "react-native-svg";

/**
 * Anel de progresso: trilho e arco (começa no topo, sentido horário). `percent` de 0 a 100 (passou de 100 vira 100:
 * o texto ao lado é que diz o excesso). Cor só no arco; o conteúdo do meio vai em `children`.
 */
export function Ring({
	percent,
	size = 72,
	stroke = 8,
	color = colors.text,
	track = colors.surface3,
	label,
	children,
}: {
	percent: number;
	size?: number;
	stroke?: number;
	color?: string;
	track?: string;
	/** Frase para leitor de tela (o anel sozinho não diz nada). */
	label?: string;
	children?: ReactNode;
}) {
	const radius = (size - stroke) / 2;
	const circumference = 2 * Math.PI * radius;
	const filled = (Math.min(100, Math.max(0, percent)) / 100) * circumference;
	const mid = size / 2;
	return (
		<View
			accessible={Boolean(label)}
			{...(label ? { accessibilityLabel: label, accessibilityRole: "image" as const } : {})}
			style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}
		>
			<Svg width={size} height={size} style={{ position: "absolute" }}>
				<Circle cx={mid} cy={mid} r={radius} stroke={track} strokeWidth={stroke} fill="none" />
				{filled > 0 ? (
					<Circle
						cx={mid}
						cy={mid}
						r={radius}
						stroke={color}
						strokeWidth={stroke}
						fill="none"
						strokeLinecap="round"
						strokeDasharray={`${filled} ${circumference}`}
						transform={`rotate(-90 ${mid} ${mid})`}
					/>
				) : null}
			</Svg>
			{children}
		</View>
	);
}
