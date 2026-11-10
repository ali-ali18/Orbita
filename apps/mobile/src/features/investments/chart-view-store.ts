import { useEffect, useSyncExternalStore } from "react";
import { getItem, KEYS, setItem } from "../../lib/storage.ts";
import {
	type ChartTarget,
	type ChartView,
	type ChartViews,
	DEFAULT_CHART_VIEWS,
	mergeLoaded,
	parseChartViews,
	serializeChartViews,
	withChartView,
} from "./chart-view.ts";

/** A escolha de "Ver como" fora da tela: sobrevive a sair e voltar e vai para o aparelho (como o tema). */
let state: ChartViews = DEFAULT_CHART_VIEWS;
let loaded = false;
const chosen = new Set<ChartTarget>();
const listeners = new Set<() => void>();

const emit = () => {
	for (const listener of [...listeners]) listener();
};

function load() {
	if (loaded) return;
	loaded = true;
	getItem(KEYS.investChartViews)
		.then((stored) => {
			// O que a pessoa já escolheu enquanto lia vale; o salvo dos outros gráficos é mantido.
			state = mergeLoaded(parseChartViews(stored), state, chosen);
			emit();
		})
		.catch(() => {});
}

export function setChartView(target: ChartTarget, view: ChartView) {
	chosen.add(target);
	const next = withChartView(state, target, view);
	if (next === state) return;
	state = next;
	emit();
	setItem(KEYS.investChartViews, serializeChartViews(state)).catch(() => {});
}

const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};
const snapshot = () => state;

export function useChartView(target: ChartTarget): [ChartView, (view: ChartView) => void] {
	useEffect(load, []);
	const views = useSyncExternalStore(subscribe, snapshot, snapshot);
	return [views[target], (view) => setChartView(target, view)];
}
