import { describe, expect, it } from "vitest";
import { pickRelinkAccount, pickRelinkCard } from "./relink.ts";

const AT = new Date("2026-11-12T09:00:00Z");

describe("candidata arquivada por conexão removida", () => {
	const account = {
		id: "x",
		name: "Conta corrente",
		kind: "checking" as const,
		bankCode: null as string | null,
		source: "pluggy" as const,
		externalId: "old",
		balanceCents: null,
		balanceSyncedAt: null,
		archivedAt: new Date("2026-11-01T00:00:00Z") as Date | null,
		connectionId: "gone",
		archiveReason: "connection_removed" as string | null,
		unlinkedMisses: 0,
		createdAt: AT,
		updatedAt: AT,
	};

	it("conta arquivada sem banco conhecido não é herdada só pelo nome", () => {
		const wanted = { name: "Conta corrente", kind: "checking" as const, bankCode: null };
		expect(pickRelinkAccount([account], new Set(), wanted, 1)).toBeNull();
		const known = { ...account, bankCode: "60701190" };
		expect(pickRelinkAccount([known], new Set(), { ...wanted, bankCode: "60701190" }, 1)).not.toBeNull();
		// A viva (não arquivada) segue como antes.
		const live = { ...account, archivedAt: null, archiveReason: null };
		expect(pickRelinkAccount([live], new Set(), wanted, 1)).not.toBeNull();
	});

	it("cartão arquivado: banco igual e conhecido, ou mesmos 4 dígitos; nome sozinho não", () => {
		const card = {
			...account,
			name: "Mastercard",
			closingDay: 10,
			dueDay: 17,
			closingRule: "closing-day-next" as const,
			closingRuleSource: "default" as const,
			limitCents: null,
			availableCents: null,
			limitSyncedAt: null,
			last4: null as string | null,
		};
		const wanted = { name: "Mastercard", last4: null as string | null, bankCode: null as string | null };
		expect(pickRelinkCard([card], new Set(), wanted, 1)).toBeNull();
		expect(
			pickRelinkCard([{ ...card, last4: "4321" }], new Set(), { ...wanted, last4: "4321" }, 1),
		).not.toBeNull();
		const known = { ...card, bankCode: "60701190" };
		expect(pickRelinkCard([known], new Set(), { ...wanted, bankCode: "60701190" }, 1)).not.toBeNull();
	});
});
