import { colors } from "@orbita/tokens";
import type { ReactNode } from "react";
import Svg, { Circle, Path, Rect } from "react-native-svg";

/*
 * Conjunto de ícones do Figma ("Icone/<nome>", página Fundamentos): viewBox 24 × 24, traço 1,75,
 * pontas e junções redondas, sem preenchimento. Os corpos abaixo são os mesmos SVGs do Figma.
 */
const bodies = {
	inicio: <Path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
	olho: (
		<>
			<Path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
			<Circle cx="12" cy="12" r="3" />
		</>
	),
	mais: <Path d="M12 5v14M5 12h14" />,
	"seta-direita": <Path d="m9 18 6-6-6-6" />,
	"seta-baixo": <Path d="m6 9 6 6 6-6" />,
	voltar: <Path d="m15 18-6-6 6-6" />,
	escanear: (
		<>
			<Path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
			<Path d="M7 12h10" />
		</>
	),
	revisar: (
		<>
			<Path d="M22 12h-6l-2 3h-4l-2-3H2" />
			<Path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
		</>
	),
	cartao: (
		<>
			<Rect x="2" y="5" width="20" height="14" rx="2" />
			<Path d="M2 10h20" />
		</>
	),
	assinatura: (
		<>
			<Path d="m17 2 4 4-4 4" />
			<Path d="M3 11v-1a4 4 0 0 1 4-4h14" />
			<Path d="m7 22-4-4 4-4" />
			<Path d="M21 13v1a4 4 0 0 1-4 4H3" />
		</>
	),
	parcelas: (
		<>
			<Path d="M12 2 2 7l10 5 10-5-10-5z" />
			<Path d="m2 17 10 5 10-5" />
			<Path d="m2 12 10 5 10-5" />
		</>
	),
	mercado: (
		<>
			<Circle cx="8" cy="21" r="1" />
			<Circle cx="19" cy="21" r="1" />
			<Path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
		</>
	),
	comida: (
		<Path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7" />
	),
	transporte: (
		<>
			<Path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9L18.4 10.5 16 6H8L5.6 10.5 3.5 11.1C2.7 11.3 2 12.1 2 13v3c0 .6.4 1 1 1h2" />
			<Circle cx="7" cy="17" r="2" />
			<Circle cx="17" cy="17" r="2" />
			<Path d="M9 17h6" />
		</>
	),
	pix: (
		<>
			<Path d="m12 2 4.5 4.5L12 11 7.5 6.5z" />
			<Path d="m12 13 4.5 4.5L12 22l-4.5-4.5z" />
			<Path d="m2 12 4.5-4.5L11 12l-4.5 4.5zM13 12l4.5-4.5L22 12l-4.5 4.5z" />
		</>
	),
	notificacao: (
		<>
			<Path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
			<Path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
		</>
	),
	enviar: <Path d="M12 19V5M5 12l7-7 7 7" />,
	check: <Path d="M20 6 9 17l-5-5" />,
	fechar: <Path d="M18 6 6 18M6 6l12 12" />,
	desfazer: (
		<>
			<Path d="M3 7v6h6" />
			<Path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
		</>
	),
	grafico: (
		<>
			<Path d="M3 3v18h18" />
			<Path d="m19 9-5 5-4-4-3 3" />
		</>
	),
	/** Do Figma "Novo lançamento" (abas e ações): mesmo traço do conjunto, redesenhados no viewBox 24. */
	"menos-circulo": (
		<>
			<Circle cx="12" cy="12" r="10" />
			<Path d="M8 12h8" />
		</>
	),
	transferir: (
		<>
			<Path d="m8 3-4 4 4 4" />
			<Path d="M4 7h16" />
			<Path d="m16 21 4-4-4-4" />
			<Path d="M20 17H4" />
		</>
	),
	microfone: (
		<>
			<Path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
			<Path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3" />
		</>
	),
	/** Não existe no Figma: o olho com um risco, só para o estado "valores escondidos". */
	"olho-cortado": (
		<>
			<Path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
			<Circle cx="12" cy="12" r="3" />
			<Path d="M4 4l16 16" />
		</>
	),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof bodies;

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
		<Svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke={color}
			strokeWidth={1.75}
			strokeLinecap="round"
			strokeLinejoin="round"
			accessibilityElementsHidden
		>
			{bodies[name]}
		</Svg>
	);
}
