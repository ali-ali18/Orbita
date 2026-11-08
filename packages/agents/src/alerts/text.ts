import {
	type BudgetThresholdHit,
	type DuplicateCharge,
	formatBRL,
	type GoalBehind,
	type MonthClosing,
	type PriceIncrease,
	type RecurringCandidate,
	type SavingSuggestion,
	type UnusualSpending,
} from "@orbita/core";
import { untrusted } from "../untrusted.ts";

/*
 * Textos-modelo dos avisos (pt-BR). É isto que o dono lê quando a IA está desligada, sem chave ou acima do limite
 * do mês. Todo número vem pronto dos detectores (centavos inteiros formatados por `formatBRL`); aqui só se monta a
 * frase. Estabelecimento e nome de categoria são texto de fora: passam por `untrusted` antes de entrar na frase.
 */

export interface AlertText {
	title: string;
	body: string;
}

const name = (value: string, max = 40) => untrusted(value, max) || "—";
const money = (cents: number) => formatBRL(cents, { sign: "never" });
/** "2026-11-07" → "07/11". */
const dayMonth = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
/** "2027-02-28" → "28/02/2027". */
const fullDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;

const MONTH_NAMES = [
	"janeiro",
	"fevereiro",
	"março",
	"abril",
	"maio",
	"junho",
	"julho",
	"agosto",
	"setembro",
	"outubro",
	"novembro",
	"dezembro",
] as const;

/** "2026-10" → "outubro de 2026". */
export function monthLabel(month: string): string {
	const index = Number(month.slice(5, 7)) - 1;
	return `${MONTH_NAMES[index] ?? month} de ${month.slice(0, 4)}`;
}

/** "+12%" / "−12%" (o sinal de menos tipográfico do styleguide). */
const signedPercent = (percent: number) => `${percent < 0 ? "−" : "+"}${Math.abs(percent)}%`;

export function unusualSpendingText(f: UnusualSpending, categoryName: string): AlertText {
	return {
		title: `Gasto fora do comum em ${name(categoryName)}`,
		body:
			`${name(f.merchant)} custou ${money(f.amountCents)} em ${dayMonth(f.date)}. ` +
			`O usual em ${name(categoryName)} é cerca de ${money(f.medianCents)} por compra.`,
	};
}

export function duplicateChargeText(f: DuplicateCharge): AlertText {
	const when =
		f.daysApart === 0
			? `duas vezes em ${dayMonth(f.date)}`
			: `em ${dayMonth(f.firstDate)} e de novo em ${dayMonth(f.date)}`;
	return {
		title: `Cobrança repetida em ${name(f.merchant)}`,
		body: `${name(f.merchant)} cobrou ${money(f.amountCents)} ${when}. Vale conferir se foi cobrado em dobro.`,
	};
}

export function budgetThresholdText(f: BudgetThresholdHit, categoryName: string | null): AlertText {
	const label = categoryName === null ? "O orçamento do mês" : name(categoryName);
	if (f.level === "over") {
		return {
			title: `${label} estourou o orçamento`,
			body: `${label} passou do limite: gastou ${money(f.spentCents)} de ${money(f.limitCents)}, ${money(-f.remainingCents)} acima.`,
		};
	}
	return {
		title: `${label} passou de ${f.thresholdPercent}% do orçamento`,
		body: `${label} já gastou ${money(f.spentCents)} de ${money(f.limitCents)}. Ainda cabem ${money(f.remainingCents)}.`,
	};
}

export function newSubscriptionText(f: RecurringCandidate): AlertText {
	return {
		title: `Possível assinatura: ${name(f.merchant)}`,
		body:
			`${name(f.merchant)} cobra cerca de ${money(f.amountCents)} todo mês ` +
			`(${f.occurrences} cobranças, a última em ${dayMonth(f.lastDate)}) e ainda não está nas Assinaturas.`,
	};
}

export function priceIncreaseText(f: PriceIncrease): AlertText {
	return {
		title: `${name(f.name)} ficou mais cara`,
		body:
			`A última cobrança de ${name(f.name)} foi ${money(f.newCents)}, contra ${money(f.previousCents)} ` +
			`cadastrados (${money(f.increaseCents)} a mais).`,
	};
}

export function goalBehindText(f: GoalBehind): AlertText {
	const deadline = f.deadline ? ` até ${fullDate(f.deadline)}` : "";
	return {
		title: `${name(f.name, 60)} está atrasada`,
		body:
			`Faltam ${money(f.remainingCents)} para ${name(f.name, 60)} (${f.percent}% guardado). ` +
			`Para chegar${deadline} é preciso guardar ${money(f.monthlyNeededCents)} por mês; o ritmo atual é de ${money(f.paceCents)}.`,
	};
}

export function savingSuggestionText(f: SavingSuggestion): AlertText {
	const caution = f.lowConfidence ? " O mês está no começo, então a projeção ainda é pouco firme." : "";
	return {
		title: `Dá para guardar ${money(f.suggestedCents)} neste mês`,
		body:
			`Com o orçamento de ${money(f.budgetCents)} e o gasto projetado de ${money(f.projectedCents)}, ` +
			`deve sobrar cerca de ${money(f.leftoverCents)}. Sugiro guardar ${money(f.suggestedCents)}.${caution} ` +
			"É só uma sugestão: eu não movo dinheiro.",
	};
}

export function monthClosingText(
	f: MonthClosing,
	options: {
		categoryName(id: string): string;
		compareWithPrevious: boolean;
		suggestLeftover: boolean;
	},
): AlertText {
	const parts = [
		`Em ${monthLabel(f.month)} você gastou ${money(f.spentCents)} e recebeu ${money(f.incomeCents)}.`,
	];
	if (options.compareWithPrevious && f.spentDeltaCents !== null) {
		const more = f.spentDeltaCents > 0;
		const same = f.spentDeltaCents === 0;
		const percent = f.spentChangePercent === null ? "" : ` (${signedPercent(f.spentChangePercent)})`;
		parts.push(
			same
				? "O gasto ficou igual ao do mês anterior."
				: `Foram ${money(Math.abs(f.spentDeltaCents))} ${more ? "a mais" : "a menos"} que no mês anterior${percent}.`,
		);
	}
	if (f.topCategories.length > 0) {
		const top = f.topCategories.map(
			(c) => `${name(options.categoryName(c.categoryId))} (${money(c.spentCents)})`,
		);
		parts.push(`Onde mais foi: ${top.join(", ")}.`);
	}
	if (f.overBudgetCount > 0) {
		parts.push(
			f.overBudgetCount === 1 ? "Um orçamento estourou." : `${f.overBudgetCount} orçamentos estouraram.`,
		);
	}
	if (options.suggestLeftover) {
		parts.push(
			f.leftoverCents > 0
				? `Sobraram ${money(f.leftoverCents)}: dá para guardar parte numa meta.`
				: "O mês fechou sem sobra.",
		);
	}
	return { title: `Fechamento de ${monthLabel(f.month)}`, body: parts.join(" ") };
}
