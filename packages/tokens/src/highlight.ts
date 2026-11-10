/**
 * Card de destaque: borda "de brilho" e luz de canto, sempre neutras: o branco de `colors.text` em opacidades
 * decrescentes (o "prata"), em qualquer tema. Não usa a cor primária (ver styleguide, "Card de destaque").
 *
 * A borda nasce forte no canto de cima à esquerda, some ao longo das duas arestas, fica invisível no meio e
 * reaparece no canto de baixo à direita. A luz é um brilho radial ancorado no mesmo canto de cima.
 *
 * Posições (`fadeAt`) vão de 0 (canto iluminado) a 1 (canto oposto), medidas na diagonal: os outros dois cantos
 * ficam em 0,5. Com `fadeAt` 0,28 a borda some a 56% de cada aresta. Opacidades vão de 0 a 1.
 *
 * Um nível só, delicado: uma borda prata que quase se confunde com o card e só "acende" no canto.
 */
export const highlight = {
	/** Espessura do traço da borda, em px: mais fino que 1, quase um fio. */
	strokeWidth: 0.75,
	/** Opacidade da borda no canto iluminado. */
	nearOpacity: 0.5,
	/** Opacidade da borda no canto oposto (mais fraca: a luz vem do outro lado). */
	farOpacity: 0.22,
	/** Onde a borda acaba de sumir (e, espelhado, onde recomeça: `1 - fadeAt`). */
	fadeAt: 0.28,
	/** Opacidade da luz no canto iluminado. Baixa: o texto do card precisa manter o contraste. */
	glowOpacity: 0.045,
	/** Raio da luz, em múltiplos da largura do card. */
	glowRadius: 0.8,
	/**
	 * Só card de largura cheia recebe: a largura dele tem de ser pelo menos esta fração da largura da tela. Card de
	 * meia largura (widget 2x2, par lado a lado) fica abaixo e não recebe.
	 */
	minWidthRatio: 0.6,
} as const;
