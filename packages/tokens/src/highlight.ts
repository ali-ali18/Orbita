/**
 * Card de destaque: borda "de brilho" e luz de canto, sempre neutras: o branco de `colors.text` em opacidades
 * decrescentes (o "prata"), em qualquer tema. Não usa a cor primária (ver styleguide, "Card de destaque").
 *
 * A borda nasce forte no canto de cima à esquerda, some ao longo das duas arestas, fica invisível no meio e
 * reaparece no canto de baixo à direita. A luz é um brilho radial ancorado no mesmo canto de cima.
 *
 * Posições (`fadeAt`) vão de 0 (canto iluminado) a 1 (canto oposto), medidas na diagonal: os outros dois cantos
 * ficam em 0,5. Com `fadeAt` 0,3 a borda some a 60% de cada aresta. Opacidades vão de 0 a 1.
 */
export const highlight = {
	/** Intensidade usada quando a tela só pede `highlight`. */
	default: "subtle",
	subtle: {
		/** Espessura do traço da borda, em px. */
		strokeWidth: 1,
		/** Opacidade da borda no canto iluminado. */
		nearOpacity: 0.9,
		/** Opacidade da borda no canto oposto (mais fraca: a luz vem do outro lado). */
		farOpacity: 0.5,
		/** Onde a borda acaba de sumir (e, espelhado, onde recomeça: `1 - fadeAt`). */
		fadeAt: 0.3,
		/** Opacidade da luz no canto iluminado. Baixa: o texto do card precisa manter o contraste. */
		glowOpacity: 0.06,
		/** Raio da luz, em múltiplos da largura do card. */
		glowRadius: 0.8,
	},
	strong: {
		strokeWidth: 1.5,
		nearOpacity: 1,
		farOpacity: 0.8,
		fadeAt: 0.42,
		glowOpacity: 0.085,
		glowRadius: 1.1,
	},
} as const;

export type HighlightLevel = Exclude<keyof typeof highlight, "default">;
