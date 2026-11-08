import { addMonths, type Cents, formatBRL, type MetricChange, type MonthKey } from "@orbita/core";
import { categoryColor } from "@orbita/tokens";
import type { MonthReportView } from "../../lib/api.ts";
import { dayMonth, monthName } from "../../lib/format.ts";
import type { CategoryLike } from "../summary/summary-model.ts";

/*
 * Funções puras do Relatório. Nenhuma conta de dinheiro: todos os números vêm do `monthReport` do engine (servidor);
 * aqui só se escolhe ordem, cor e texto.
 */

const lower = (month: MonthKey) => monthName(month).toLocaleLowerCase("pt-BR");

/** "+34%", "−12%", "0%"; `null` (mês de referência sem valor) não tem percentual. */
export function percentLabel(percent: number | null): string | null {
	if (percent === null) return null;
	if (percent === 0) return "0%";
	return `${percent > 0 ? "+" : "−"}${Math.abs(percent)}%`;
}

/** Legenda de Entrou/Saiu: "igual a setembro", "8% a menos", "12% a mais". Sem comparação, diz isso. */
export function changeCaption(
	change: MetricChange | undefined,
	referenceMonth: MonthKey | undefined,
): string {
	if (!change || !referenceMonth) return "sem mês anterior para comparar";
	if (change.deltaCents === 0) return `igual a ${lower(referenceMonth)}`;
	if (change.percent === null)
		return `${change.deltaCents > 0 ? "a mais" : "a menos"} que ${lower(referenceMonth)}`;
	const abs = Math.abs(change.percent);
	if (abs === 0) return `igual a ${lower(referenceMonth)}`;
	return `${abs}% ${change.deltaCents > 0 ? "a mais" : "a menos"}`;
}

/** A frase grande do topo: "R$ 312,40 de sobra" (ou o quanto passou do que entrou). */
export function headline(balanceCents: Cents): { lead: string; amount: Cents; tail: string } {
	if (balanceCents > 0) return { lead: "fechou com", amount: balanceCents, tail: "de sobra" };
	if (balanceCents < 0) return { lead: "fechou com", amount: -balanceCents, tail: "a mais do que entrou" };
	return { lead: "fechou", amount: 0, tail: "no zero a zero" };
}

/** O mês que abre primeiro: o último fechado com dado; sem ele, o mais recente com dado; sem nada, o mês passado. */
export function initialMonth(months: readonly MonthKey[], currentMonth: MonthKey): MonthKey {
	const closed = months.filter((m) => m < currentMonth).sort();
	const lastClosed = closed.at(-1);
	if (lastClosed) return lastClosed;
	const latest = [...months].sort().at(-1);
	return latest ?? addMonths(currentMonth, -1);
}

export interface MonthChoice {
	month: MonthKey;
	/** "fechado" ou "em andamento". */
	status: string;
}

/** Meses para escolher, do mais antigo ao mais novo; o mês aberto de hoje sempre aparece. */
export function monthChoices(months: readonly MonthKey[], currentMonth: MonthKey): MonthChoice[] {
	const all = new Set([...months, currentMonth]);
	return [...all]
		.sort()
		.map((month) => ({ month, status: month < currentMonth ? "fechado" : "em andamento" }));
}

/** "Relatório de outubro · 1 de nov" (fechado) ou "Relatório de novembro · parcial" (mês ainda aberto). */
export function reportSubtitle(report: Pick<MonthReportView, "month" | "closedOn">, currentMonth: MonthKey) {
	const tail = report.month < currentMonth ? dayMonth(report.closedOn) : "parcial";
	return `Relatório de ${lower(report.month)} · ${tail}`;
}

export interface CategoryBar {
	key: string;
	name: string;
	color: string;
	spentCents: Cents;
	previousCents: Cents;
	percent: string | null;
	/** Comprimento das barras, de 0 a 1, na mesma régua para todas as linhas. */
	currentRatio: number;
	previousRatio: number;
}

/**
 * Uma linha por categoria do `topCategories` do engine: barra do mês na cor da categoria e a do mês anterior em
 * cinza, as duas na mesma régua (a maior de todas vale 1). Razão de barra é só desenho, não é dinheiro.
 */
export function categoryBars(
	rows: MonthReportView["topCategories"],
	categories: readonly CategoryLike[],
): CategoryBar[] {
	const byId = new Map(categories.map((c) => [c.id, c]));
	const max = Math.max(1, ...rows.flatMap((r) => [r.spentCents, r.previousCents]));
	return rows.map((r) => {
		const category = byId.get(r.categoryId);
		const name = category?.name ?? "Outros";
		return {
			key: r.categoryId,
			name,
			color: categoryColor({ slug: category?.slug, chartSlot: category?.chartSlot }),
			spentCents: r.spentCents,
			previousCents: r.previousCents,
			percent: percentLabel(r.percent),
			currentRatio: r.spentCents / max,
			previousRatio: r.previousCents / max,
		};
	});
}

/** Quanto a barra não pode ficar menor que isso para continuar visível (px). */
export const MIN_BAR = 4;

/**
 * Texto do "Órbita diz…". Por enquanto é um modelo fixo montado só com os números do engine, sem IA.
 *
 * TODO(ia-resumo): quando o agente de Fechamento existir, ele troca esta função: recebe o mesmo `MonthReportView`,
 * escreve o texto com ferramentas (nunca faz conta) e este modelo fica de reserva para quando a IA estiver fora do
 * ar ou desligada.
 */
export function narrative(report: MonthReportView, categories: readonly CategoryLike[]): string {
	const name = (id: string) => categories.find((c) => c.id === id)?.name ?? "Outros";
	const parts: string[] = [];
	const rows = report.topCategories.filter((c) => c.percent !== null);
	const rise = [...rows].filter((c) => c.deltaCents > 0).sort((a, b) => b.deltaCents - a.deltaCents)[0];
	const fall = [...rows].filter((c) => c.deltaCents < 0).sort((a, b) => a.deltaCents - b.deltaCents)[0];
	if (rise?.percent) parts.push(`${name(rise.categoryId)} subiu ${rise.percent}%.`);
	if (
		report.subscriptions.change &&
		report.subscriptions.change.deltaCents > 0 &&
		report.subscriptions.change.percent
	) {
		parts.push(`As assinaturas subiram ${report.subscriptions.change.percent}%.`);
	}
	if (fall?.percent) {
		parts.push(`${rise ? "Em compensação, " : ""}${name(fall.categoryId)} caiu ${Math.abs(fall.percent)}%.`);
	}
	if (parts.length === 0) {
		parts.push(
			report.vsPrevious
				? "Os gastos por categoria ficaram parecidos com os do mês anterior."
				: "Ainda não há mês anterior para comparar.",
		);
	}
	const { balanceCents } = report.totals;
	if (balanceCents > 0) parts.push(`Sobraram ${formatBRL(balanceCents)}.`);
	else if (balanceCents < 0) parts.push(`Saiu ${formatBRL(-balanceCents)} a mais do que entrou.`);
	return parts.join(" ");
}

/** Linha de orçamento do relatório: "3 de 4 limites respeitados". */
export function budgetLine(budget: MonthReportView["budget"]): string | null {
	const total = budget.withinCount + budget.overCount;
	if (total === 0) return null;
	return `${budget.withinCount} de ${total} ${total === 1 ? "limite respeitado" : "limites respeitados"}`;
}
