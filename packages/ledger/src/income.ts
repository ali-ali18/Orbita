import { type IncomeSource, incomeForMonth, type LocalDate, monthOf, nextPayday } from "@orbita/core";
import type { IncomeSourceRecord, Stores } from "@orbita/db";
import type { IncomeListResponse, IncomeSourceDto } from "@orbita/shared";

export const toIncomeSourceDto = (s: IncomeSourceRecord): IncomeSourceDto => ({
	id: s.id,
	name: s.name,
	amountCents: s.amountCents,
	payday: s.payday,
	accountId: s.accountId,
	recurring: s.recurring,
	month: s.month,
	archivedAt: s.archivedAt?.toISOString() ?? null,
	createdAt: s.createdAt.toISOString(),
	updatedAt: s.updatedAt.toISOString(),
});

/** A forma que o engine espera. */
export const toCoreIncome = (s: IncomeSourceRecord): IncomeSource => ({
	id: s.id,
	amountCents: s.amountCents,
	payday: s.payday,
	recurring: s.recurring,
	month: s.month,
});

/** As fontes ativas, o que entra neste mês e o próximo pagamento: tudo contas do engine. */
export async function incomeOverview(stores: Stores, today: LocalDate): Promise<IncomeListResponse> {
	const sources = await stores.incomeSources.list();
	const core = sources.map(toCoreIncome);
	return {
		sources: sources.map(toIncomeSourceDto),
		monthIncomeCents: incomeForMonth(core, monthOf(today)),
		nextPayday: nextPayday(core, today),
	};
}
