/**
 * Paleta de gráficos, validada para daltonismo sobre #141414. A ORDEM importa.
 * Nunca gere uma 6ª cor: o que passar de 5 categorias entra em "outros".
 */
export const chartSeries = ["#3987E5", "#D95926", "#199E70", "#C98500", "#D55181"] as const;

export const chart = {
	blue: "#3987E5",
	orange: "#D95926",
	aqua: "#199E70",
	yellow: "#C98500",
	magenta: "#D55181",
	other: "#5A5A5A",
} as const;

/** Cor padrão de cada categoria de gasto. */
export const defaultCategoryColor = {
	mercado: chart.blue,
	delivery: chart.orange,
	transporte: chart.aqua,
	assinaturas: chart.yellow,
	lazer: chart.magenta,
	outros: chart.other,
} as const;
