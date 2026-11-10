import { colors, radius } from "@orbita/tokens";
import { View } from "react-native";
import Svg, { Circle, G, Path } from "react-native-svg";
import { Text } from "./Text.tsx";

/** Olhos do avatar, copiados do vetor do Figma (componente "Avatar/Agente", 176 × 176). */
const EYES =
	"M 22.2 10.9 L 22 8 L 21 5.4 L 19.5 3.1 L 17.3 1.4 L 14.8 0.3 L 12.1 0 L 9.3 0.4 L 6.6 1.5 L 4.3 3.3 L 2.4 5.6 L 1.2 8.3 L 0.6 11.2 L 0.4 13.8 L 0.3 16.5 L 0.2 19.2 L 0.1 21.9 L 0.1 24.6 L 0 27.3 L 0 30 L 0.1 32.7 L 0.2 35.5 L 0.3 38.2 L 0.8 41.1 L 1.9 43.8 L 3.7 46.1 L 6 47.9 L 8.7 49 L 11.5 49.3 L 14.2 48.9 L 16.8 47.8 L 18.9 45.9 L 20.6 43.6 L 21.5 40.8 L 21.8 37.9 L 21.8 35.2 L 21.7 32.5 L 21.7 29.7 L 21.7 27 L 21.7 24.3 L 21.8 21.6 L 21.8 18.9 L 21.9 16.2 L 22 13.5 L 22.2 10.9 Z M 54.4 10.9 L 54.6 8 L 55.6 5.4 L 57.1 3.1 L 59.3 1.4 L 61.8 0.3 L 64.5 0 L 67.3 0.4 L 70 1.5 L 72.3 3.3 L 74.2 5.6 L 75.4 8.3 L 76 11.2 L 76.2 13.8 L 76.3 16.5 L 76.4 19.2 L 76.5 21.9 L 76.5 24.6 L 76.6 27.3 L 76.6 30 L 76.5 32.7 L 76.4 35.5 L 76.3 38.2 L 75.8 41.1 L 74.7 43.8 L 72.9 46.1 L 70.6 47.9 L 67.9 49 L 65.1 49.3 L 62.4 48.9 L 59.8 47.8 L 57.7 45.9 L 56 43.6 L 55.1 40.8 L 54.8 37.9 L 54.8 35.2 L 54.9 32.5 L 54.9 29.7 L 54.9 27 L 54.9 24.3 L 54.8 21.6 L 54.8 18.9 L 54.7 16.2 L 54.6 13.5 L 54.4 10.9 Z";

/** Avatar da Órbita, idêntico ao do Figma: círculo branco com os dois olhos inclinados 10°. */
export function OrbitaAvatar({ size = 52, color = colors.text }: { size?: number; color?: string }) {
	return (
		<Svg width={size} height={size} viewBox="0 0 176 176" accessibilityLabel="Órbita" role="img">
			<Circle cx={88} cy={88} r={87.9} fill={color} />
			<G transform="matrix(0.98481 -0.17365 0.17365 0.98481 62.0622 37.7199)">
				<Path d={EYES} fill={colors.background} />
			</G>
		</Svg>
	);
}

/** Círculo com uma letra (você, banco sem logo). `color` padrão: avatar sem foto. */
export function LetterAvatar({
	letter,
	size = 44,
	color = colors.surface3,
}: {
	letter: string;
	size?: number;
	color?: string;
}) {
	return (
		<View
			style={{
				width: size,
				height: size,
				borderRadius: radius.pill,
				backgroundColor: color,
				alignItems: "center",
				justifyContent: "center",
			}}
		>
			<Text variant="bodyStrong">{letter}</Text>
		</View>
	);
}
