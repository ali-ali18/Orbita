/**
 * Card de destaque: borda "de brilho" e luz de canto, sempre neutras: o branco de `colors.text` em opacidades
 * decrescentes (o "prata"), em qualquer tema. Não usa a cor primária (ver styleguide, "Card de destaque").
 *
 * A borda nasce forte no canto de cima à esquerda, some ao longo das duas arestas, fica invisível no meio e
 * reaparece no canto de baixo à direita. A luz é um brilho radial ancorado no mesmo canto de cima.
 *
 * O alcance da borda é medido em px a partir de cada canto (`reachX` na aresta horizontal, `reachY` na vertical),
 * e não em fração do card: num card alto o trecho aceso tem o mesmo comprimento que num baixo. Opacidades de 0 a 1.
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
	/** Até onde a borda vai, em px, na aresta horizontal a partir do canto (de cima no iluminado, de baixo no oposto). */
	reachX: 200,
	/** Até onde a borda vai, em px, na aresta vertical a partir do canto. */
	reachY: 120,
	/** Em card pequeno o alcance encolhe: no máximo esta fração do lado, para sempre sobrar um trecho sem borda. */
	reachMaxRatio: 0.8,
	/**
	 * Folga, em px, que o desenho ganha para fora do card em cada lado. A borda fica rente à aresta do card; se a tela
	 * do desenho acabasse ali, qualquer diferença de arredondamento entre ela e o card cortava a aresta de baixo.
	 */
	bleed: 4,
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
