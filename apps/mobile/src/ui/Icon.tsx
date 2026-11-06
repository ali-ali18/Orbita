import { colors } from "@orbita/tokens";
import Svg, { Circle, Path } from "react-native-svg";

const paths = {
	home: ["M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"],
	plus: ["M12 5v14", "M5 12h14"],
	eye: ["M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"],
	"eye-off": ["M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z", "M4 4l16 16"],
	"chevron-right": ["M9 6l6 6-6 6"],
	scan: [
		"M3 7V5a2 2 0 0 1 2-2h2",
		"M17 3h2a2 2 0 0 1 2 2v2",
		"M21 17v2a2 2 0 0 1-2 2h-2",
		"M7 21H5a2 2 0 0 1-2-2v-2",
		"M7 12h10",
	],
	layers: ["M12 2 2 7l10 5 10-5-10-5z", "M2 17l10 5 10-5", "M2 12l10 5 10-5"],
	card: ["M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z", "M3 10h18"],
} as const;

export type IconName = keyof typeof paths;

export function Icon({
	name,
	size = 20,
	color = colors.text,
}: {
	name: IconName;
	size?: number;
	color?: string;
}) {
	return (
		<Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessibilityElementsHidden>
			{paths[name].map((d) => (
				<Path key={d} d={d} stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
			))}
			{name === "eye" || name === "eye-off" ? (
				<Circle cx={12} cy={12} r={3} stroke={color} strokeWidth={2} />
			) : null}
		</Svg>
	);
}
