import { type FeeKind, formatBRL, type SavingsOpportunity, type SavingsResult } from "@orbita/core";
import type { AlertText } from "../alerts/text.ts";
import { untrusted } from "../untrusted.ts";

/*
 * Textos do agente Economia (pt-BR). Todo número vem pronto do engine (`findSavingsOpportunities`, centavos inteiros
 * formatados por `formatBRL`); aqui só se monta a frase. Nome de serviço, de categoria e de estabelecimento é texto
 * de fora: passa por `untrusted`. A IA, quando liga, só reescreve estes textos e `acceptWording` derruba qualquer
 * número que não esteja neles.
 */

const name = (value: string, max = 40) => untrusted(value, max) || "—";
const money = (cents: number) => formatBRL(cents, { sign: "never" });
const dayMonth = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

const FEE_LABEL: Record<FeeKind, string> = {
	interest: "juros e encargos",
	iof: "IOF",
	annuity: "anuidade",
	bank_fee: "tarifas bancárias",
};

const GROUP_LABEL = {
	music: "de música",
	ai: "de IA",
	video: "de vídeo",
	same: "do mesmo serviço",
} as const;

export const OPPORTUNITY_ACTION_LABEL = {
	cancel_reminder: "Cancelar lembrete",
	create_limit: "Criar limite",
	ignore: "Ignorar",
} as const;
export type OpportunityActionId = keyof typeof OPPORTUNITY_ACTION_LABEL;

/** Título e texto-modelo de um achado. */
export function opportunityText(o: SavingsOpportunity, categoryName: (id: string) => string): AlertText {
	switch (o.type) {
		case "duplicate_subscription": {
			const { services, group } = o.detail;
			const list = services.map((s) => `${name(s.name)} (${money(s.amountCents)})`);
			const names = services.map((s) => name(s.name));
			return {
				title:
					group === "same" ? `${names[0]} está duas vezes` : `Assinaturas parecidas: ${names.join(" e ")}`,
				body:
					group === "same"
						? `${list.join(" e ")} são do mesmo serviço. Ficar com um só economiza ao menos ${money(o.monthlySavingsCents)} por mês.`
						: `${list.join(" e ")} são serviços ${GROUP_LABEL[group]}. Ficar com um só economiza ao menos ${money(o.monthlySavingsCents)} por mês.`,
			};
		}
		case "price_increase": {
			const d = o.detail;
			return {
				title: `${name(d.name)} ficou mais cara`,
				body: `A última cobrança foi ${money(d.newCents)}, contra ${money(d.previousCents)} cadastrados: ${money(d.increaseCents)} a mais por mês.`,
			};
		}
		case "category_above_average": {
			const d = o.detail;
			const cat = name(categoryName(d.categoryId));
			return {
				title: `${cat} acima da média`,
				body:
					`Neste mês já foram ${money(d.spentCents)} em ${cat}, contra a média de ${money(d.averageCents)} ` +
					`dos últimos ${d.monthsUsed} meses (${d.percentAbove}% acima). Voltar à média economiza ${money(d.excessCents)}.`,
			};
		}
		case "fees": {
			const d = o.detail;
			const label = FEE_LABEL[d.feeKind];
			const tail = d.feeKind === "interest" ? " Pagar a fatura em dia evita isso." : "";
			return {
				title: `Você pagou ${money(d.totalCents)} em ${label}`,
				body:
					`Nos últimos ${d.windowDays} dias foram ${d.count === 1 ? "1 cobrança" : `${d.count} cobranças`} de ${label}, ` +
					`somando ${money(d.totalCents)}: cerca de ${money(d.monthlyCents)} por mês.${tail}`,
			};
		}
		case "small_recurring": {
			const d = o.detail;
			return {
				title: `${name(d.merchant)}: ${d.count} compras pequenas`,
				body:
					`${d.count} compras em ${d.windowDays} dias, média de ${money(d.averageCents)}, somando ${money(d.totalCents)}. ` +
					`Cortar ${d.cutPercent}% das idas economizaria cerca de ${money(o.monthlySavingsCents)} por mês.`,
			};
		}
		case "installments_load": {
			const d = o.detail;
			return {
				title: "Parcelas pesam na renda",
				body:
					`As parcelas vigentes somam ${money(d.committedCents)} neste mês, ${d.percent}% da renda de ${money(d.incomeCents)}. ` +
					`Acima de ${d.thresholdPercent}% o orçamento aperta; voltar a esse limite liberaria ${money(o.monthlySavingsCents)}.`,
			};
		}
		case "projected_over": {
			const d = o.detail;
			const budget = d.reference === "budget";
			const caution = o.confidence === "low" ? " O mês está no começo: a projeção ainda é pouco firme." : "";
			return {
				title: budget ? "O mês deve passar do orçamento" : "O mês deve passar da renda",
				body: `O gasto projetado é ${money(d.projectedCents)}, contra ${money(d.referenceCents)} de ${budget ? "orçamento" : "renda"}: ${money(d.excessCents)} a mais.${caution}`,
			};
		}
		case "invoice_unfunded": {
			const d = o.detail;
			return {
				title: "Fatura a vencer sem saldo",
				body:
					`Faturas de ${money(d.owedCents)} vencem até ${dayMonth(d.dueDate)} e o saldo em conta é ${money(d.balanceCents)}: ` +
					`faltam ${money(d.shortfallCents)}. Pagar em atraso gera juros.`,
			};
		}
	}
}

/** As ações de um toque que um achado oferece. `ignore` sempre; as outras dependem do que o achado e o app permitem. */
export function opportunityActions(
	o: SavingsOpportunity,
	state: { remindingSubscriptionIds: ReadonlySet<string>; limitedCategoryIds: ReadonlySet<string> },
): OpportunityActionId[] {
	const actions: OpportunityActionId[] = [];
	if (
		(o.type === "duplicate_subscription" || o.type === "price_increase") &&
		o.evidence.subscriptionIds.some((id) => state.remindingSubscriptionIds.has(id))
	) {
		actions.push("cancel_reminder");
	}
	if (o.type === "category_above_average" && !state.limitedCategoryIds.has(o.detail.categoryId)) {
		actions.push("create_limit");
	}
	actions.push("ignore");
	return actions;
}

/** Quantos achados o relatório lista. */
export const REPORT_TOP = 3;

/**
 * O relatório curto: o total que dá para cortar por mês e os maiores achados, um por linha. `null` quando não há nada
 * a dizer (o agente não manda aviso vazio).
 */
export function savingsReportText(
	result: SavingsResult,
	categoryName: (id: string) => string,
): AlertText | null {
	const top = result.opportunities.slice(0, REPORT_TOP);
	if (top.length === 0) return null;
	const lines = top.map((o, i) => {
		const text = opportunityText(o, categoryName);
		return o.monthlySavingsCents > 0
			? `${i + 1}) ${text.title}: ${money(o.monthlySavingsCents)} por mês.`
			: `${i + 1}) ${text.title}.`;
	});
	const count = result.opportunities.length;
	const found = count === 1 ? "Achei 1 ponto" : `Achei ${count} pontos`;
	const title =
		result.totalMonthlySavingsCents > 0
			? `Dá para cortar até ${money(result.totalMonthlySavingsCents)} por mês`
			: "Pontos de atenção no seu dinheiro";
	return { title, body: `${found} para olhar. ${lines.join(" ")}` };
}
