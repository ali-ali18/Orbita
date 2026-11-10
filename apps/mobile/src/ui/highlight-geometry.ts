/**
 * Geometria do card de destaque: onde desenhar a borda, a linha do gradiente que a faz sumir no meio e a luz do canto.
 * Só contas de posição; as medidas e opacidades entram prontas (tokens `highlight`).
 */

export interface HighlightSpec {
	strokeWidth: number;
	nearOpacity: number;
	farOpacity: number;
	/** Alcance da borda, em px, na aresta horizontal e na vertical, a partir de cada canto aceso. */
	reachX: number;
	reachY: number;
	/** Teto do alcance, como fração do lado do card. */
	reachMaxRatio: number;
	glowOpacity: number;
	glowRadius: number;
}

export interface HighlightInput extends HighlightSpec {
	width: number;
	height: number;
	/** Raio do canto do card. */
	radius: number;
	/** Folga do desenho para fora do card: tudo é deslocado por ela (o card começa em `bleed, bleed`). Padrão 0. */
	bleed?: number;
}

export interface HighlightStop {
	/** 0 no canto iluminado, 1 no canto oposto. */
	offset: number;
	opacity: number;
}

export interface HighlightGeometry {
	/** Tamanho da tela do desenho: o card mais a folga dos dois lados. */
	canvas: { width: number; height: number };
	/** O card inteiro dentro da tela (fundo da luz). */
	card: { x: number; y: number; width: number; height: number; rx: number };
	/** Retângulo do traço, recuado meia espessura para a borda ficar toda dentro do card. */
	rect: { x: number; y: number; width: number; height: number; rx: number };
	/** Linha do gradiente da borda, em px da tela (`userSpaceOnUse`). */
	line: { x1: number; y1: number; x2: number; y2: number };
	stops: HighlightStop[];
	/** Alcance usado de fato (já com o teto do card pequeno). */
	reach: { x: number; y: number };
	/** Luz radial: centro no canto iluminado, some no raio `r`. */
	glow: { cx: number; cy: number; r: number; opacity: number };
}

function round(value: number): number {
	return Math.round(value * 100) / 100;
}

/**
 * A borda acende nos dois cantos opostos e some a uma distância fixa em px de cada um: `reachX` ao longo da aresta
 * horizontal, `reachY` ao longo da vertical. Um só gradiente linear faz isso: a opacidade depende de
 * `x / reachX + y / reachY` (1 = acabou de sumir), então as linhas de mesma opacidade cortam as duas arestas do canto
 * nesses dois pontos, e o mesmo vale, espelhado, para o canto oposto.
 *
 * Antes o alcance era uma fração da diagonal: num card alto, o canto de baixo acendia quase metade da aresta direita.
 * Em px, o trecho aceso é igual em card alto, largo ou quadrado. Em card pequeno o alcance encolhe
 * (`reachMaxRatio`), então sempre sobra um trecho sem borda e as duas paradas transparentes nunca coincidem.
 *
 * Sem tamanho medido (largura ou altura zero) devolve `null`: nada a desenhar.
 */
export function highlightGeometry(input: HighlightInput): HighlightGeometry | null {
	const { width: w, height: h, strokeWidth: sw } = input;
	if (!(w > 0) || !(h > 0)) return null;
	const bleed = Math.max(0, input.bleed ?? 0);
	const inset = sw / 2;
	const rectW = Math.max(0, w - sw);
	const rectH = Math.max(0, h - sw);
	const outer = Math.max(0, Math.min(input.radius, w / 2, h / 2));
	const rx = Math.max(0, Math.min(input.radius - inset, rectW / 2, rectH / 2));
	const ratio = Math.min(0.95, Math.max(0.05, input.reachMaxRatio));
	const a = Math.max(1, Math.min(input.reachX, w * ratio));
	const b = Math.max(1, Math.min(input.reachY, h * ratio));
	// f(x, y) = x/a + y/b vale 0 no canto iluminado e `total` no oposto. A linha do gradiente segue a direção em que f
	// cresce, (1/a, 1/b), do canto iluminado até onde f chega a `total`.
	const total = w / a + h / b;
	const norm2 = 1 / (a * a) + 1 / (b * b);
	const fade = 1 / total;
	return {
		canvas: { width: round(w + bleed * 2), height: round(h + bleed * 2) },
		card: { x: bleed, y: bleed, width: w, height: h, rx: round(outer) },
		rect: { x: bleed + inset, y: bleed + inset, width: round(rectW), height: round(rectH), rx: round(rx) },
		line: {
			x1: bleed,
			y1: bleed,
			x2: round(bleed + total / a / norm2),
			y2: round(bleed + total / b / norm2),
		},
		stops: [
			{ offset: 0, opacity: input.nearOpacity },
			{ offset: fade, opacity: 0 },
			{ offset: 1 - fade, opacity: 0 },
			{ offset: 1, opacity: input.farOpacity },
		],
		reach: { x: round(a), y: round(b) },
		glow: { cx: bleed, cy: bleed, r: round(w * input.glowRadius), opacity: input.glowOpacity },
	};
}

export interface CardSize {
	width: number;
	height: number;
}

/**
 * Tamanho a guardar depois de uma medida. Mudou a largura ou a altura (o card cresceu quando os dados chegaram, os
 * valores foram escondidos, a fonte do sistema mudou)? Vale a medida nova, e o desenho é refeito. Igual? Devolve o
 * mesmo objeto, para não redesenhar à toa.
 */
export function measuredSize(prev: CardSize | null, next: CardSize): CardSize {
	return prev && prev.width === next.width && prev.height === next.height ? prev : next;
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
