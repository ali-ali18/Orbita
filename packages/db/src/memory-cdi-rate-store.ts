import { type CdiRateRecord, type CdiRateStore, checkCdiRow } from "./cdi-rate-store.ts";
import type { MemoryState } from "./memory-state.ts";

export function createMemoryCdiRateStore(state: MemoryState): CdiRateStore {
	return {
		async upsertMany(rows) {
			// Tudo ou nada: valida antes de gravar qualquer linha.
			const checked = rows.map(checkCdiRow);
			const at = state.now();
			let created = 0;
			let updated = 0;
			for (const row of checked) {
				const current = state.cdiRates.get(row.day);
				// Igual ao que já está gravado: nada a fazer (nem conta como alteração).
				if (current?.rateE8 === row.rateE8) continue;
				if (current) updated++;
				else created++;
				state.cdiRates.set(row.day, { ...row, fetchedAt: at });
			}
			return { created, updated };
		},
		async list(filter = {}) {
			return [...state.cdiRates.values()]
				.filter(
					(r) =>
						(filter.from === undefined || r.day >= filter.from) &&
						(filter.to === undefined || r.day <= filter.to),
				)
				.sort((a, b) => a.day.localeCompare(b.day))
				.map((r): CdiRateRecord => ({ ...r }));
		},
		async latest() {
			let best: CdiRateRecord | null = null;
			for (const r of state.cdiRates.values()) if (best === null || r.day > best.day) best = r;
			return best ? { ...best } : null;
		},
	};
}
