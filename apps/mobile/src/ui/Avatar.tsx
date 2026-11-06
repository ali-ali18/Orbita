import { colors, radius } from "@orbita/tokens";
import { View } from "react-native";
import Svg, { Circle, Rect } from "react-native-svg";
import { Text } from "./Text.tsx";

/** Avatar da Órbita: círculo branco com dois olhos verticais escuros. */
export function OrbitaAvatar({ size = 52 }: { size?: number }) {
	return (
		<Svg width={size} height={size} viewBox="0 0 100 100" accessibilityLabel="Órbita" role="img">
			<Circle cx={50} cy={50} r={50} fill={colors.accent} />
			<Rect x={32} y={30} width={11} height={28} rx={5.5} fill={colors.onAccent} />
			<Rect x={57} y={30} width={11} height={28} rx={5.5} fill={colors.onAccent} />
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
