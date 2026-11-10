/*
 * "Ver como" dos gráficos de Investimentos: o dono segura o gráfico e escolhe Barras, Barra horizontal ou Rosca. A
 * escolha é por gráfico (Classes e Instituições) e fica guardada neste aparelho. Puro, para testar.
 */

export const CHART_VIEWS = ["bars", "hbars", "donut"] as const;
export type ChartView = (typeof CHART_VIEWS)[number];

export const CHART_TARGETS = ["classes", "institutions"] as const;
export type ChartTarget = (typeof CHART_TARGETS)[number];

export type ChartViews = Record<ChartTarget, ChartView>;

export const CHART_VIEW_LABELS: Record<ChartView, string> = {
	bars: "Barras",
	hbars: "Barra horizontal",
	donut: "Rosca",
};

/** Instituições abrem em barras (a escolhida no desenho) e Classes em rosca. */
export const DEFAULT_CHART_VIEWS: ChartViews = { classes: "donut", institutions: "bars" };

const isView = (value: unknown): value is ChartView => CHART_VIEWS.some((v) => v === value);

/** Lê o que foi guardado; texto inválido, ausente ou valor desconhecido volta ao padrão daquele gráfico. */
export function parseChartViews(raw: string | null): ChartViews {
	const result: ChartViews = { ...DEFAULT_CHART_VIEWS };
	if (!raw) return result;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return result;
	}
	if (typeof parsed !== "object" || parsed === null) return result;
	const record = parsed as Record<string, unknown>;
	for (const target of CHART_TARGETS) {
		const value = record[target];
		if (isView(value)) result[target] = value;
	}
	return result;
}

export function serializeChartViews(views: ChartViews): string {
	return JSON.stringify(views);
}

export function withChartView(views: ChartViews, target: ChartTarget, view: ChartView): ChartViews {
	return views[target] === view ? views : { ...views, [target]: view };
}

/**
 * O valor lido do aparelho chega depois de a pessoa já ter escolhido algo: vale a escolha nos gráficos que ela mexeu e
 * o valor guardado nos outros (não descarta o que estava salvo dos demais).
 */
export function mergeLoaded(
	loaded: ChartViews,
	current: ChartViews,
	chosen: ReadonlySet<ChartTarget>,
): ChartViews {
	const result: ChartViews = { ...loaded };
	for (const target of chosen) result[target] = current[target];
	return result;
}
