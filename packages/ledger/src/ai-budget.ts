import { monthOf, toLocalDate } from "@orbita/core";
import type { Stores } from "@orbita/db";
import { formatUsdCents } from "@orbita/shared";

const MICRO_PER_USD_CENT = 10_000;

export function limitMessage(limitUsdCents: number): string {
	return (
		`O limite de gasto com a IA neste mês (${formatUsdCents(limitUsdCents)}) foi atingido. ` +
		"Aumente o limite em Configurações → Servidor e chaves ou espere o mês virar."
	);
}

/**
 * Texto de bloqueio se o gasto do mês com a IA já alcançou o limite; `null` se pode seguir. O chat e o worker
 * dos agentes usam a mesma conta: o gasto de ambos entra no mesmo limite mensal.
 */
export async function budgetBlock(deps: {
	stores: Pick<Stores, "aiUsage">;
	now: () => Date;
}): Promise<string | null> {
	const limit = await deps.stores.aiUsage.getMonthlyLimit();
	if (limit === null) return null;
	const month = monthOf(toLocalDate(deps.now()));
	const { costMicroUsd: spent } = await deps.stores.aiUsage.monthTotals(month);
	return spent >= limit * MICRO_PER_USD_CENT ? limitMessage(limit) : null;
}
