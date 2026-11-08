import { type AgentVisualKey, agents, colors } from "@orbita/tokens";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { OrbitaAvatar } from "../../ui/index.ts";

/*
 * O rosto de cada agente: uma forma na cor do agente (token) e os dois olhos escuros, como no Figma. A forma é um
 * desenho simples em um quadrado de 100; a Órbita usa o avatar dela.
 */

/** Estrela de 5 pontas arredondada: centro (50, 52), raio externo 42 e interno 24, com a ponta para cima. */
const STAR = (() => {
	const points: string[] = [];
	for (let i = 0; i < 10; i++) {
		const radius = i % 2 === 0 ? 42 : 24;
		const angle = (Math.PI / 5) * i - Math.PI / 2;
		points.push(
			`${(50 + radius * Math.cos(angle)).toFixed(1)} ${(52 + radius * Math.sin(angle)).toFixed(1)}`,
		);
	}
	return `M${points.join("L")}Z`;
})();

const SHIELD =
	"M50 6 C70 6 88 12 88 12 L88 50 C88 74 68 90 50 96 C32 90 12 74 12 50 L12 12 C12 12 30 6 50 6 Z";
const LEAF = "M50 4 Q78 22 96 50 Q78 78 50 96 Q22 78 4 50 Q22 22 50 4 Z";

function Shape({ kind, color }: { kind: AgentVisualKey; color: string }) {
	switch (kind) {
		case "vigia":
			return <Path d={SHIELD} fill={color} stroke={color} strokeWidth={8} strokeLinejoin="round" />;
		case "fechamento":
			return (
				<>
					<Circle cx={30} cy={60} r={22} fill={color} />
					<Circle cx={50} cy={42} r={26} fill={color} />
					<Circle cx={72} cy={58} r={24} fill={color} />
					<Rect x={30} y={58} width={42} height={24} fill={color} />
				</>
			);
		case "metas":
			return <Path d={STAR} fill={color} stroke={color} strokeWidth={14} strokeLinejoin="round" />;
		case "caca_assinatura":
			return <Rect x={8} y={8} width={84} height={84} rx={28} fill={color} />;
		case "cofrinho":
			return <Path d={LEAF} fill={color} stroke={color} strokeWidth={8} strokeLinejoin="round" />;
		default:
			return <Circle cx={50} cy={50} r={44} fill={color} />;
	}
}

export function AgentAvatar({
	visual,
	size = 44,
	name,
}: {
	visual: AgentVisualKey;
	size?: number;
	name: string;
}) {
	if (visual === "orbita") return <OrbitaAvatar size={size} />;
	const { color } = agents[visual];
	return (
		<Svg width={size} height={size} viewBox="0 0 100 100" accessibilityLabel={name} role="img">
			<Shape kind={visual} color={color} />
			<Rect x={34} y={38} width={10} height={24} rx={5} fill={colors.background} />
			<Rect x={56} y={38} width={10} height={24} rx={5} fill={colors.background} />
		</Svg>
	);
}
