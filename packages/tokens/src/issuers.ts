/**
 * Faixa de cada emissor na carteira de cartões do Início: cor da marca e a cor do texto que passa AA (4,5:1) sobre ela.
 * A chave é o ISPB do banco (o mesmo de `bankLogoKey` do app). Emissor sem entrada usa `issuerFallback`.
 */
export interface IssuerBand {
	band: string;
	text: string;
}

const WHITE = "#FFFFFF";
const INK = "#111111";

export const issuers: Readonly<Record<string, IssuerBand>> = {
	"90400888": { band: "#EC0000", text: WHITE }, // Santander
	"18236120": { band: "#820AD1", text: WHITE }, // Nubank
	"10573521": { band: "#FFE600", text: INK }, // Mercado Pago
	"00416968": { band: "#EA7100", text: INK }, // Inter
	"60701190": { band: "#EC7000", text: INK }, // Itaú
	"31872495": { band: "#242424", text: WHITE }, // C6 Bank
	"22896431": { band: "#11C76F", text: INK }, // PicPay
	"60746948": { band: "#CD2375", text: WHITE }, // Bradesco
};

/** Banco que o app não conhece: cinza neutro. */
export const issuerFallback: IssuerBand = { band: "#3A3A3A", text: WHITE };

/** A faixa do emissor pelo ISPB (ou o cinza neutro). */
export function issuerBand(ispb: string | null | undefined): IssuerBand {
	return (ispb ? issuers[ispb] : undefined) ?? issuerFallback;
}

function luminance(hex: string): number {
	const [r, g, b] = [1, 3, 5].map((i) => {
		const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	}) as [number, number, number];
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Razão de contraste WCAG entre duas cores hex (1 a 21). */
export function contrastRatio(a: string, b: string): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
	return (hi + 0.05) / (lo + 0.05);
}

/** Preto ou branco, o que contrasta mais com `background` (para uma marca nova sem texto definido). */
export function readableTextOn(background: string): string {
	return contrastRatio(background, WHITE) >= contrastRatio(background, INK) ? WHITE : INK;
}
