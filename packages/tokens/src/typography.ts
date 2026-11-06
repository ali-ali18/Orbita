/** Família tipográfica e estilos de texto (tamanhos e alturas de linha em px). */
export const fontFamily = { sans: "Geist" } as const;

const style = (
	fontWeight: 400 | 500 | 600 | 700,
	fontSize: number,
	lineHeight: number,
	letterSpacing: number,
) => ({ fontFamily: fontFamily.sans, fontWeight, fontSize, lineHeight, letterSpacing }) as const;

export const text = {
	numberHero: style(700, 40, 46, -1.5),
	numberLarge: style(600, 28, 32, -0.8),
	numberMedium: style(600, 20, 23, -0.4),
	greeting: style(600, 30, 34, -1),
	cardTitle: style(500, 15, 20, -0.1),
	body: style(400, 15, 20, -0.1),
	bodyStrong: style(600, 15, 20, -0.1),
	caption: style(400, 13, 18, 0),
	micro: style(500, 11, 15, 0.2),
} as const;
