import type { Cents } from "@orbita/core";
import { dayMonth, monthName } from "../../lib/format.ts";

/*
 * "Como chegamos nesse número": a tela só agrupa e rotula o que `GET /v1/summary/:mês/breakdown` devolveu (os
 * números e os ramos são do engine). Nada aqui soma o que o servidor não somou.
 */

export type Branch = "account" | "card" | "projected";

export interface BreakdownRow {
	id: string;
	branch: Branch;
	date: string;
	invoiceMonth: string | null;
	budgetMonth: string;
	kind: string;
	description: string;
	amountCents: Cents;
	deltaCents: Cents;
	categoryId: string | null;
	estimated: boolean;
}

export interface BranchTotal {
	branch: Branch;
	count: number;
	subtotalCents: Cents;
}

export const BRANCH_TITLES: Record<Branch, string> = {
	account: "Conta (débito, Pix, boleto)",
	card: "Cartão (pela fatura)",
	projected: "Parcelas estimadas",
};

export const BRANCH_HINTS: Record<Branch, string> = {
	account: "Conta pesa no mês da data.",
	card: "Cartão pesa no mês em que a fatura vence, não no da compra.",
	projected: "O banco ainda não lançou; entram como estimativa.",
};

export interface BreakdownSection {
	branch: Branch;
	title: string;
	hint: string;
	count: number;
	subtotalCents: Cents;
	rows: BreakdownRow[];
}

const ORDER: readonly Branch[] = ["account", "card", "projected"];

/** Uma seção por ramo, na ordem fixa; ramo sem linha some. Dentro do ramo, a data mais recente primeiro. */
export function sections(
	rows: readonly BreakdownRow[],
	branches: readonly BranchTotal[],
): BreakdownSection[] {
	return ORDER.flatMap((branch) => {
		const own = rows.filter((r) => r.branch === branch).sort((a, b) => b.date.localeCompare(a.date));
		if (own.length === 0) return [];
		const total = branches.find((b) => b.branch === branch);
		return [
			{
				branch,
				title: BRANCH_TITLES[branch],
				hint: BRANCH_HINTS[branch],
				count: total?.count ?? own.length,
				subtotalCents: total?.subtotalCents ?? own.reduce((acc, r) => acc + r.deltaCents, 0),
				rows: own,
			},
		];
	});
}

/** "30 de out · fatura de novembro" (cartão) ou "2 de nov" (conta); a estimada diz só a fatura. */
export function rowCaption(row: Pick<BreakdownRow, "date" | "invoiceMonth" | "estimated" | "kind">): string {
	const invoice = row.invoiceMonth
		? `fatura de ${monthName(row.invoiceMonth).toLocaleLowerCase("pt-BR")}`
		: null;
	if (row.estimated) return ["estimada", invoice].filter(Boolean).join(" · ");
	const kind = row.kind === "refund" ? "estorno" : null;
	return [dayMonth(row.date), invoice, kind].filter(Boolean).join(" · ");
}
