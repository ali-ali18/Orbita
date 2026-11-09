import { randomUUID } from "node:crypto";
import { byDueDesc, normalizeBill } from "./bill-rules.ts";
import type { BillRecord, BillStore } from "./bill-store.ts";
import { badReference } from "./errors.ts";
import type { MemoryState } from "./memory-state.ts";

const copy = (b: BillRecord): BillRecord => ({ ...b, payments: b.payments.map((p) => ({ ...p })) });

export function createMemoryBillStore(state: MemoryState): BillStore {
	const find = (source: string, externalId: string) =>
		[...state.bills.values()].find((b) => b.source === source && b.externalId === externalId);
	return {
		async upsert(input) {
			const data = normalizeBill(input);
			if (!state.cards.has(data.cardId)) throw badReference();
			const existing = find(data.source, data.externalId);
			const record: BillRecord = { id: existing?.id ?? randomUUID(), ...data };
			state.bills.set(record.id, record);
			return copy(record);
		},
		async get(id) {
			const found = state.bills.get(id);
			return found ? copy(found) : null;
		},
		async findByExternal(source, externalId) {
			const found = find(source, externalId);
			return found ? copy(found) : null;
		},
		async listByCard(cardId) {
			return [...state.bills.values()]
				.filter((b) => b.cardId === cardId)
				.sort(byDueDesc)
				.map(copy);
		},
		async list() {
			return [...state.bills.values()].sort(byDueDesc).map(copy);
		},
	};
}
