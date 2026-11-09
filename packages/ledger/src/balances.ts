import type { Stores } from "@orbita/db";
import type { AccountBalanceLineDto, AccountBalancesResponse } from "@orbita/shared";

const percentOf = (part: number, whole: number): number => Math.round((part / whole) * 1000) / 10;

/**
 * Saldo em contas: o que o banco informou (`Account.balanceCents`, lido no sync) de cada conta ativa, o total e a
 * parte de cada uma. Conta sem saldo do banco (manual, ou ainda não lida) aparece marcada (`hasBalance: false`,
 * saldo `null`) e fica fora do total: ausente não é zero. Só leitura; o Órbita não recalcula saldo por lançamentos.
 */
export async function accountBalances(stores: Stores): Promise<AccountBalancesResponse> {
	const accounts = (await stores.accounts.list()).filter((a) => a.archivedAt === null);
	const known = accounts.flatMap((a) => (a.balanceCents === null ? [] : [a.balanceCents]));
	const totalCents = known.reduce((sum, v) => sum + v, 0);
	const lines: AccountBalanceLineDto[] = accounts.map((a) => ({
		accountId: a.id,
		name: a.name,
		bankCode: a.bankCode,
		kind: a.kind,
		balanceCents: a.balanceCents,
		hasBalance: a.balanceCents !== null,
		sharePercent:
			a.balanceCents !== null && a.balanceCents > 0 && totalCents > 0
				? percentOf(a.balanceCents, totalCents)
				: null,
		syncedAt: a.balanceCents === null ? null : (a.balanceSyncedAt?.toISOString() ?? null),
	}));
	lines.sort(
		(a, b) =>
			Number(b.hasBalance) - Number(a.hasBalance) ||
			(b.balanceCents ?? 0) - (a.balanceCents ?? 0) ||
			a.name.localeCompare(b.name, "pt-BR"),
	);
	const synced = lines.flatMap((l) => (l.syncedAt ? [l.syncedAt] : [])).sort();
	return {
		totalCents,
		accounts: lines,
		withoutBalanceCount: lines.filter((l) => !l.hasBalance).length,
		oldestSyncedAt: synced[0] ?? null,
	};
}
