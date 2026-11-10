/** Medidas fixas de layout que vêm do Figma e não são passos da escala de espaçamento. */
export const layout = {
	/** Faixa da barra de status que toda tela reserva no topo (mínimo, se a área segura for menor). */
	statusBar: 56,
	/** Folga mínima embaixo, onde fica a barra de gestos do sistema. */
	homeIndicator: 28,
	/** Alvo de toque mínimo (acessibilidade). */
	touchTarget: 44,
	/** Diâmetro da rosca de categorias (`DonutChart`). */
	donut: 176,
	/** Espessura do anel da rosca. */
	donutStroke: 20,
	/** Header fixo do Início (avatar e olho); as abas vêm logo abaixo. */
	homeHeader: 64,
	/** Faixa das abas do Início (alvo de toque mais a folga de baixo). */
	homeTabs: 56,
	/** Altura das abas pequenas dentro do cabeçalho de um card (a área de toque chega a 44 pelo hitSlop). */
	miniTab: 32,
	/** Gráfico de barras verticais (Instituições): altura da área, barra mínima e largura da barra. */
	barArea: 152,
	barMin: 16,
	barWidth: 44,
	/** Barras de aporte e rendimento por mês (Evolução). */
	monthBarArea: 120,
	monthBarMin: 12,
	monthBarWidth: 16,
	/** Linha de lista de posição e linha de movimentação. */
	positionRow: 64,
	movementRow: 56,
	/** Espessura da barra horizontal. */
	hbar: 12,
	/** Altura da linha de evolução (patrimônio) e da do detalhe da posição. */
	lineChart: 172,
	lineChartSmall: 140,
	/** Estado vazio de um número que falta (Investimentos): disco do ícone e o ícone dentro dele. */
	emptyIconDisc: 32,
	emptyIcon: 20,
	/** Ponto de "falta completar" ao lado do nome de uma posição. */
	statusDot: 8,
} as const;
