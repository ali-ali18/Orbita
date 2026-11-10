/**
 * Geometria do card de destaque: onde desenhar a borda, a linha do gradiente que a faz sumir no meio e a luz do canto.
 * Só contas de posição; as medidas e opacidades entram prontas (tokens `highlight`).
 */

export interface HighlightSpec {
	strokeWidth: number;
	nearOpacity: number;
	farOpacity: number;
	fadeAt: number;
	glowOpacity: number;
	glowRadius: number;
}

export interface HighlightInput extends HighlightSpec {
	width: number;
	height: number;
	/** Raio do canto do card. */
	radius: number;
}

export interface HighlightStop {
	/** 0 no canto iluminado, 1 no canto oposto. */
	offset: number;
	opacity: number;
}

export interface HighlightGeometry {
	/** Retângulo do traço, recuado meia espessura para a borda ficar toda dentro do card. */
	rect: { x: number; y: number; width: number; height: number; rx: number };
	/** Linha do gradiente da borda, em px do card (`userSpaceOnUse`). */
	line: { x1: number; y1: number; x2: number; y2: number };
	stops: HighlightStop[];
	/** Luz radial: centro no canto iluminado, some no raio `r`. */
	glow: { cx: number; cy: number; r: number; opacity: number };
}

function round(value: number): number {
	return Math.round(value * 100) / 100;
}

/**
 * A linha do gradiente passa pelo centro, perpendicular à diagonal que liga os outros dois cantos. Assim, em card de
 * qualquer proporção, o canto de cima à esquerda cai em 0, o de baixo à direita em 1 e os outros dois exatamente em
 * 0,5, e a posição anda por igual nas arestas: `fadeAt` 0,3 some a 60% da de cima e a 60% da esquerda.
 * (Uma linha de canto a canto num card largo deixaria a aresta esquerda inteira acesa.)
 *
 * Sem tamanho medido (largura ou altura zero) devolve `null`: nada a desenhar.
 */
export function highlightGeometry(input: HighlightInput): HighlightGeometry | null {
	const { width: w, height: h, strokeWidth: sw } = input;
	if (!(w > 0) || !(h > 0)) return null;
	const inset = sw / 2;
	const rectW = Math.max(0, w - sw);
	const rectH = Math.max(0, h - sw);
	const rx = Math.max(0, Math.min(input.radius - inset, rectW / 2, rectH / 2));
	const diagonal2 = w * w + h * h;
	// Projeção do canto sobre a direção (h, w), a partir do centro.
	const dx = (w * h * h) / diagonal2;
	const dy = (w * w * h) / diagonal2;
	const fade = Math.min(0.5, Math.max(0, input.fadeAt));
	return {
		rect: { x: inset, y: inset, width: round(rectW), height: round(rectH), rx: round(rx) },
		line: {
			x1: round(w / 2 - dx),
			y1: round(h / 2 - dy),
			x2: round(w / 2 + dx),
			y2: round(h / 2 + dy),
		},
		stops: [
			{ offset: 0, opacity: input.nearOpacity },
			{ offset: fade, opacity: 0 },
			{ offset: round(1 - fade), opacity: 0 },
			{ offset: 1, opacity: input.farOpacity },
		],
		glow: { cx: 0, cy: 0, r: round(w * input.glowRadius), opacity: input.glowOpacity },
	};
}

/**
 * O card recebe o destaque? Só o de largura cheia: a largura dele precisa alcançar `minRatio` da largura da tela.
 * Dois cards lado a lado (widget 2x2) ficam abaixo disso. Sem medida ainda, não.
 */
export function highlightApplies(cardWidth: number, screenWidth: number, minRatio: number): boolean {
	if (!(cardWidth > 0) || !(screenWidth > 0)) return false;
	return cardWidth >= screenWidth * minRatio;
}

/** Posição (0 a 1) de um ponto do card na linha do gradiente. Serve ao teste e a quem for animar a borda. */
export function highlightPosition(point: { x: number; y: number }, line: HighlightGeometry["line"]): number {
	const vx = line.x2 - line.x1;
	const vy = line.y2 - line.y1;
	const length2 = vx * vx + vy * vy;
	if (length2 === 0) return 0;
	return ((point.x - line.x1) * vx + (point.y - line.y1) * vy) / length2;
}

/** Opacidade da borda numa posição, interpolando as paradas (como o SVG faz). */
export function highlightOpacityAt(position: number, stops: readonly HighlightStop[]): number {
	const first = stops[0];
	const last = stops[stops.length - 1];
	if (!first || !last) return 0;
	if (position <= first.offset) return first.opacity;
	for (let i = 1; i < stops.length; i++) {
		const a = stops[i - 1] as HighlightStop;
		const b = stops[i] as HighlightStop;
		if (position <= b.offset) {
			const span = b.offset - a.offset;
			return span <= 0 ? b.opacity : a.opacity + ((position - a.offset) / span) * (b.opacity - a.opacity);
		}
	}
	return last.opacity;
}
