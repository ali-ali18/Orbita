import { useSyncExternalStore } from "react";
import { type ActivityFilters, EMPTY_FILTERS } from "./filters-model.ts";

/**
 * Guarda os filtros de Atividades fora da tela: sair para o Início e voltar (a tela desmonta) não os perde.
 * Vive só na memória do app; fechar o app limpa (guardar em disco fica para quando fizer falta).
 */
export interface FiltersStore {
	get(): ActivityFilters;
	set(next: ActivityFilters): void;
	subscribe(listener: () => void): () => void;
}

export function createFiltersStore(initial: ActivityFilters = EMPTY_FILTERS): FiltersStore {
	let state = initial;
	const listeners = new Set<() => void>();
	return {
		get: () => state,
		set(next) {
			if (next === state) return;
			state = next;
			for (const listener of [...listeners]) listener();
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}

/** O app tem uma lista de filtros só (Atividades). */
export const activityFilters = createFiltersStore();

export function useActivityFilters(): [ActivityFilters, (next: ActivityFilters) => void] {
	const value = useSyncExternalStore(activityFilters.subscribe, activityFilters.get, activityFilters.get);
	return [value, activityFilters.set];
}
