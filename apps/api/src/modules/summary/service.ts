import {
	budgetStatus,
	type Cents,
	invoiceByMonth,
	invoiceComposition,
	invoiceStatus,
	type LocalDate,
	type MonthKey,
	monthOf,
	paidForInvoice,
	paymentStatus,
	paymentWindow,
	pendingInMonth,
	projectMonth,
	remainingInstallments,
	safeToSpend,
	summarizeMonth,
	type Transaction,
	UNCATEGORIZED,
} from "@orbita/core";
import {
	type InstallmentGroupRecord,
	type Stores,
	TOTAL_BUDGET_SCOPE,
	type TransactionRecord,
	toCardConfig,
	toMonthlyRecurrence,
} from "@orbita/db";
import type { MonthSummaryResponse } from "@orbita/shared";
import { orNotFound } from "../../http/errors.ts";

const sum = (values: Iterable<Cents>) => {
	let total = 0;
	for (const v of values) total += v;
	return total;
};

/** A forma que o engine espera (`null` vira ausente). */
const toCoreTransaction = (t: TransactionRecord): Transaction => ({
	id: t.id,
	kind: t.kind,
	amountCents: t.amountCents,
	date: t.date,
	budgetMonth: t.budgetMonth,
	...(t.categoryId === null ? {} : { categoryId: t.categoryId }),
	...(t.refundOfId === null ? {} : { refundOf: t.refundOfId }),
});

/** Compras originais de estornos que moram em outro mês (para o estorno abater a categoria certa). */
async function refundOriginalsOutside(stores: Stores, txs: readonly TransactionRecord[]) {
	const inList = new Set(txs.map((t) => t.id));
	const missing = [
		...new Set(
			txs.flatMap((t) => (t.refundOfId !== null && !inList.has(t.refundOfId) ? [t.refundOfId] : [])),
		),
	];
	const found: TransactionRecord[] = [];
	for (let i = 0; i < missing.length; i += 500) {
		found.push(...(await stores.transactions.getMany(missing.slice(i, i + 500))));
	}
	return found;
}

/**
 * Início: tudo calculado pelo engine. Lançamento pendente (ainda sem revisão) conta no gasto:
 * a notificação do banco já avisou que o dinheiro saiu.
 */
export async function monthSummary(
	stores: Stores,
	month: MonthKey,
	today: LocalDate,
): Promise<MonthSummaryResponse> {
	const [txs, recurrences, postings, budgets, outros] = await Promise.all([
		stores.transactions.listByBudgetMonth(month),
		stores.recurrences.list(),
		stores.recurrences.listPostings(month),
		stores.budgets.list(),
		stores.categories.getBySlug("outros"),
	]);
	const originals = await refundOriginalsOutside(stores, txs);
	const raw = summarizeMonth([...txs, ...originals].map(toCoreTransaction), month);

	// O engine agrupa o que não tem categoria sob a chave "outros"; para o app (e para um
	// orçamento da categoria Outros) essa chave é o id real da categoria.
	const byCategory: Record<string, Cents> = { ...raw.byCategory };
	const loose = byCategory[UNCATEGORIZED];
	if (loose !== undefined && outros) {
		delete byCategory[UNCATEGORIZED];
		byCategory[outros.id] = (byCategory[outros.id] ?? 0) + loose;
	}

	const budgetRows = budgets.map((b) => {
		const spentCents = b.scope === TOTAL_BUDGET_SCOPE ? raw.spentCents : (byCategory[b.scope] ?? 0);
		const status = budgetStatus({ limitCents: b.limitCents, spentCents });
		return {
			scope: b.scope,
			limitCents: b.limitCents,
			spentCents,
			remainingCents: status.remainingCents,
			ratio: Number.isFinite(status.ratio) ? status.ratio : null,
			overBudget: status.overBudget,
		};
	});

	const pending = pendingInMonth(recurrences.map(toMonthlyRecurrence), month, postings);

	let safe: MonthSummaryResponse["safeToSpend"] = null;
	let projection: MonthSummaryResponse["projection"] = null;
	if (monthOf(today) === month) {
		// Gasto variável = o que saiu sem ser recorrência já lançada (o aluguel tem data certa).
		const postedIds = new Set(postings.map((p) => p.transactionId));
		const recurringSpent = sum(
			txs.filter((t) => t.kind === "expense" && postedIds.has(t.id)).map((t) => t.amountCents),
		);
		const total = budgets.find((b) => b.scope === TOTAL_BUDGET_SCOPE);
		if (total) {
			safe = safeToSpend({
				budgetCents: total.limitCents,
				spentCents: raw.spentCents,
				pendingRecurringExpenseCents: pending.expenseCents,
				today,
				month,
			});
		}
		projection = projectMonth({
			spentCents: raw.spentCents,
			pendingRecurringExpenseCents: pending.expenseCents,
			variableSpentCents: Math.max(0, raw.spentCents - recurringSpent),
			today,
			month,
		});
	}

	return {
		month,
		summary: {
			spentCents: raw.spentCents,
			incomeCents: raw.incomeCents,
			refundCreditCents: raw.refundCreditCents,
			byCategory,
		},
		budgets: budgetRows,
		safeToSpend: safe,
		projection,
		pendingRecurring: pending,
		refundCreditCents: raw.refundCreditCents,
	};
}

export async function cardInvoice(stores: Stores, cardId: string, month: MonthKey, today: LocalDate) {
	const card = orNotFound(await stores.cards.get(cardId), "Cartão", "o");
	const invoice = invoiceByMonth(month, toCardConfig(card));
	const config = toCardConfig(card);
	const [txs, payments] = await Promise.all([
		stores.transactions.listByInvoice(cardId, month),
		stores.transactions.listCardPayments(cardId, paymentWindow(month, config)),
	]);
	// Um posting vale para o mês do orçamento do lançamento: busca só os meses que aparecem na fatura.
	const budgetMonths = [
		...new Set(txs.filter((t) => t.installmentGroupId === null).map((t) => t.budgetMonth)),
	];
	const postings = (await Promise.all(budgetMonths.map((m) => stores.recurrences.listPostings(m)))).flat();
	const composition = invoiceComposition(txs, {
		recurringTransactionIds: new Set(postings.map((p) => p.transactionId)),
	});
	// Pago = pagamentos de fatura (`card_payment`) atribuídos a esta fatura (regra em `invoice-payment.ts` do core).
	const paidCents = paidForInvoice(payments, month, config);
	return {
		card,
		invoice: {
			...invoice,
			status: invoiceStatus(invoice, today),
			paidCents,
			paymentStatus: paymentStatus(invoice, composition.totalCents, paidCents, today),
		},
		composition,
		transactions: txs,
	};
}

export async function activeInstallments(stores: Stores, from: MonthKey) {
	const groups = await stores.transactions.listInstallmentGroups(from);
	return groups.map((g) => installmentGroupView(g, from));
}

function installmentGroupView(group: InstallmentGroupRecord, from: MonthKey) {
	const first = group.installments[0];
	const last = group.installments.at(-1);
	const count = first?.installmentCount ?? group.installments.length;
	const progress = remainingInstallments(
		group.installments.map((t) => ({
			number: t.installmentNumber ?? 0,
			count: t.installmentCount ?? 0,
			amountCents: t.amountCents,
			invoiceMonth: t.invoiceMonth ?? t.budgetMonth,
			budgetMonth: t.budgetMonth,
		})),
		from,
	);
	// Grupo que cresce (parcelas importadas do banco, uma por fatura): as parcelas depois da última vista ainda não
	// existem. Contam como "faltam", pelo valor da última parcela vista (estimativa; a real chega com a fatura).
	// Parcelas ANTES da primeira vista não entram: o Órbita não sabe o que foram.
	const unseen = Math.max(0, count - (last?.installmentNumber ?? count));
	const estimateCents = last ? unseen * last.amountCents : 0;
	return {
		groupId: group.groupId,
		description: first?.description ?? "",
		cardId: first?.cardId ?? null,
		count,
		totalCents: progress.paidCents + progress.remainingCents + estimateCents,
		paidCents: progress.paidCents,
		remainingCents: progress.remainingCents + estimateCents,
		paidCount: progress.paidCount,
		remainingCount: progress.remainingCount + unseen,
		installments: group.installments,
	};
}
