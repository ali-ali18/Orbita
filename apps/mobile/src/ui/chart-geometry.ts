/** Geometria de gráficos de linha: só escala pontos para a caixa do desenho, sem saber de dinheiro. */

export interface ChartPoint {
	x: number;
	y: number;
}

export interface ChartBox {
	width: number;
	height: number;
	/** Folga em volta da linha, para o traço e a bolinha não serem cortados. */
	pad: number;
}

export interface ChartDomain {
	xMax: number;
	yMax: number;
}

function round(value: number): number {
	return Math.round(value * 100) / 100;
}

/** Posição de um ponto na caixa: x cresce para a direita; y cresce para cima (o SVG cresce para baixo). */
export function project(point: ChartPoint, box: ChartBox, domain: ChartDomain): ChartPoint {
	const w = Math.max(0, box.width - box.pad * 2);
	const h = Math.max(0, box.height - box.pad * 2);
	const x = domain.xMax > 0 ? point.x / domain.xMax : 0;
	const y = domain.yMax > 0 ? point.y / domain.yMax : 0;
	return {
		x: round(box.pad + Math.min(1, Math.max(0, x)) * w),
		y: round(box.pad + (1 - Math.min(1, Math.max(0, y))) * h),
	};
}

/** Caminho SVG ("M x y L x y …") da série. Sem pontos, texto vazio. */
export function linePath(points: readonly ChartPoint[], box: ChartBox, domain: ChartDomain): string {
	return points
		.map((p, i) => {
			const { x, y } = project(p, box, domain);
			return `${i === 0 ? "M" : "L"}${x} ${y}`;
		})
		.join(" ");
}

export interface DonutArc {
	/** Posição na lista de pesos recebida. */
	index: number;
	/** Comprimento do traço desenhado (já sem folga e sem as pontas redondas). */
	length: number;
	/** Onde o traço começa, contado do topo no sentido horário. */
	start: number;
}

/**
 * Arcos de uma rosca com pontas redondas: cada segmento ocupa `peso / soma` da circunferência e perde `gap` (espaço
 * visível entre vizinhos) mais a espessura (as duas meias-pontas que o traço redondo acrescenta). Um segmento só
 * fecha o anel inteiro, sem folga. Peso zero ou negativo some.
 */
export function donutArcs(
	weights: readonly number[],
	radius: number,
	stroke: number,
	gap: number,
): DonutArc[] {
	const circumference = 2 * Math.PI * radius;
	const positive = weights.map((w) => Math.max(w, 0));
	const total = positive.reduce((a, b) => a + b, 0);
	if (total <= 0) return [];
	const visible = positive.filter((w) => w > 0).length;
	const cut = gap + stroke;
	// Fatia menor que a folga viraria um ponto por cima da vizinha: ganha o mínimo (um ponto com folga) e as demais
	// dividem o que sobra, na mesma proporção.
	const minArc = cut + 1;
	const raw = positive.map((w) => (w / total) * circumference);
	const tiny = raw.filter((a) => a > 0 && a < minArc).length;
	const bigSum = raw.filter((a) => a >= minArc).reduce((x, y) => x + y, 0);
	const scale = bigSum > 0 ? Math.max(0, circumference - tiny * minArc) / bigSum : 1;
	const arcs: DonutArc[] = [];
	let cursor = 0;
	raw.forEach((share, index) => {
		if (share <= 0) return;
		if (visible === 1) {
			arcs.push({ index, length: round(circumference), start: 0 });
			return;
		}
		const arc = share < minArc ? minArc : share * scale;
		arcs.push({ index, length: round(Math.max(0.01, arc - cut)), start: round(cursor + cut / 2) });
		cursor += arc;
	});
	return arcs;
}
