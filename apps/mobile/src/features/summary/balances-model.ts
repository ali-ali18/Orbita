import type { AccountBalancesView } from "../../lib/api.ts";

type Line = AccountBalancesView["accounts"][number];

/**
 * Contas na ordem da tela: com saldo informado primeiro (maior saldo antes), depois as sem saldo (por nome).
 * Conta sem saldo do banco não é zero: fica marcada e fora do total.
 */
export function sortBalanceLines<T extends Pick<Line, "name" | "hasBalance" | "balanceCents">>(
	lines: readonly T[],
): T[] {
	return [...lines].sort((a, b) => {
		if (a.hasBalance !== b.hasBalance) return a.hasBalance ? -1 : 1;
		return (b.balanceCents ?? 0) - (a.balanceCents ?? 0) || a.name.localeCompare(b.name, "pt-BR");
	});
}

const KIND_LABEL: Record<Line["kind"], string> = {
	checking: "Conta corrente",
	savings: "Poupança",
	wallet: "Carteira",
	investment: "Investimento",
};

export function accountKindLabel(kind: Line["kind"]): string {
	return KIND_LABEL[kind];
}

/** Aviso sobre contas sem saldo do banco ("2 contas sem saldo do banco ficam fora do total"); `null` se não há. */
export function withoutBalanceNotice(count: number): string | null {
	if (count <= 0) return null;
	return count === 1
		? "1 conta sem saldo do banco fica fora do total."
		: `${count} contas sem saldo do banco ficam fora do total.`;
}
