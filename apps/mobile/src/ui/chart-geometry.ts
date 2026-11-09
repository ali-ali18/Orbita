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
