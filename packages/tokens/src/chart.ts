/**
 * Paleta de gráficos, visível sobre #141414. A ORDEM é a das categorias padrão:
 * Mercado, Delivery, Transporte, Assinaturas, Lazer, Moradia, Saúde, Transferências, Investimentos, Outros.
 * `other` fica para o que não é categoria (estorno na fatura).
 */
export const chartSeries = [
	"#3987E5",
	"#D95926",
	"#199E70",
	"#C98500",
	"#D55181",
	"#7C5CFF",
	"#2EC4D6",
	"#E23D3D",
	"#8FBF3F",
	"#7AA2FF",
] as const;

export const chart = {
	blue: "#3987E5",
	orange: "#D95926",
	aqua: "#199E70",
	yellow: "#C98500",
	magenta: "#D55181",
	violet: "#7C5CFF",
	cyan: "#2EC4D6",
	red: "#E23D3D",
	lime: "#8FBF3F",
	sky: "#7AA2FF",
	other: "#5A5A5A",
} as const;

/** Cor padrão de cada categoria. O slug manda quando a categoria ainda não tem espaço no gráfico. */
export const defaultCategoryColor = {
	mercado: chart.blue,
	delivery: chart.orange,
	transporte: chart.aqua,
	assinaturas: chart.yellow,
	lazer: chart.magenta,
	moradia: chart.violet,
	saude: chart.cyan,
	transferencias: chart.red,
	investimentos: chart.lime,
	outros: chart.sky,
} as const;

const namedCategoryColor: Readonly<Record<string, string>> = defaultCategoryColor;

/** Cor da bolinha e da barra. Espaço escolhido pelo dono vence; senão, a cor do slug; senão, uma cor estável do nome. */
export function categoryColor(input: {
	slug?: string | null | undefined;
	chartSlot?: number | null | undefined;
}): string {
	if (input.chartSlot !== null && input.chartSlot !== undefined) {
		const chosen = chartSeries[input.chartSlot];
		if (chosen !== undefined) return chosen;
	}
	if (input.slug) {
		const named = namedCategoryColor[input.slug];
		if (named !== undefined) return named;
		let hash = 0;
		for (let i = 0; i < input.slug.length; i++) hash = (hash * 33 + input.slug.charCodeAt(i)) >>> 0;
		return chartSeries[hash % chartSeries.length] ?? chartSeries[0];
	}
	return chart.other;
}
