import {
	addMonths,
	budgetStatus,
	type Cents,
	invoiceByMonth,
	invoiceComposition,
	invoiceStatus,
	type LocalDate,
	type MonthKey,
	monthOf,
	paidForInvoice,
	passedThreshold,
	paymentStatus,
	paymentWindow,
	pendingInMonth,
	projectMissingInstallments,
	projectMonth,
	remainingInstallments,
	safeToSpend,
	summarizeMonth,
	type Transaction,
	UNCATEGORIZED,
} from "@orbita/core";
import {
	DataError,
	type InstallmentGroupRecord,
	type Stores,
	TOTAL_BUDGET_SCOPE,
	type TransactionRecord,
	toCardConfig,
	toMonthlyRecurrence,
} from "@orbita/db";
import { suggestSpendingSlug } from "@orbita/ingest";
import type { MonthSummaryResponse, SpendingBranch, SpendingBreakdownResponse } from "@orbita/shared";

/** Item que não existe: o mesmo erro de dados que as stores lançam (a API o traduz em 404). */
function orNotFound<T>(value: T | null | undefined, what: string, ending: "a" | "o" = "a"): T {
	if (value === null || value === undefined)
		throw new DataError("not_found", `${what} não encontrad${ending}.`);
	return value;
}

const sum = (values: Iterable<Cents>) => {
	let total = 0;
	for (const v of values) total += v;
	return total;
};

/**
 * Gasto ainda em Outros, que o dono não editou, usa a categoria que o texto do banco já permite
 * (iFood, Uber, "Food and drinks"). PIX sem compra vira Transferências; aplicação vira Investimentos.
 */
export function categoryForSummary(
	t: TransactionRecord,
	outrosId: string | null,
	bySlug: ReadonlyMap<string, string>,
): string | null {
	if (t.categoryEditedByOwner) return t.categoryId;
	if (t.kind !== "expense" && t.kind !== "refund") return t.categoryId;
	if (t.categoryId !== null && t.categoryId !== outrosId) return t.categoryId;
	const slug = suggestSpendingSlug({
		sourceCategory: t.sourceCategory,
		description: t.description,
		merchantName: t.merchantName,
	});
	if (slug === null || slug === "outros") return t.categoryId;
	return bySlug.get(slug) ?? t.categoryId;
}

/** Prefixo do id das parcelas estimadas (só existem na resposta, nunca no banco). */
export const PROJECTED_ID_PREFIX = "est-";
export const isProjectedRow = (t: Pick<TransactionRecord, "id">) => t.id.startsWith(PROJECTED_ID_PREFIX);

/** A forma que o engine espera (`null` vira ausente). */
export const toCoreTransaction = (
	t: TransactionRecord,
	outrosId: string | null,
	bySlug: ReadonlyMap<string, string>,
): Transaction => {
	const categoryId = categoryForSummary(t, outrosId, bySlug);
	return {
		id: t.id,
		kind: t.kind,
		amountCents: t.amountCents,
		date: t.date,
		budgetMonth: t.budgetMonth,
		...(categoryId === null ? {} : { categoryId }),
		...(t.refundOfId === null ? {} : { refundOf: t.refundOfId }),
	};
};

/** Compras originais de estornos que moram em outro mês (para o estorno abater a categoria certa). */
export async function refundOriginalsOutside(stores: Stores, txs: readonly TransactionRecord[]) {
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
 * O conjunto do "Gasto do mês", o mesmo para o Início, o relatório, a sugestão de orçamento, as ferramentas da IA e os
 * avisos: tudo pela DATA da compra (`budgetMonth`, competência). Compra no cartão pesa no mês em que foi feita e cada
 * parcela no seu (mês da compra + n − 1); a fatura é outra visão (`invoicesOverview`). Nada estimado entra aqui.
 */
export function loadSpendingMonth(
	stores: Stores,
	month: MonthKey,
	_today?: LocalDate,
): Promise<TransactionRecord[]> {
	return stores.transactions.listByBudgetMonth(month);
}

/**
 * Parcelas que o banco ainda não lançou, de grupos já vistos, na fatura que vence em `month` (estimadas, só para
 * planejar o futuro e para a visão da fatura; nunca somam ao Gasto). Só de hoje em diante e só enquanto a fatura está
 * aberta; a parcela que a fatura já tem não é estimada de novo.
 */
export async function plannedInstallments(
	stores: Stores,
	month: MonthKey,
	today: LocalDate,
): Promise<TransactionRecord[]> {
	if (month < monthOf(today)) return [];
	const [cards, groups] = await Promise.all([
		stores.cards.list(),
		stores.transactions.listInstallmentGroups(addMonths(month, -71)),
	]);
	const open = cards
		.filter((c) => c.archivedAt === null)
		.filter((c) => invoiceStatus(invoiceByMonth(month, toCardConfig(c)), today) === "open");
	const perCard = await Promise.all(
		open.map(async (c) =>
			projectedRows(groups, c.id, month, `${month}-01`, await stores.transactions.listByInvoice(c.id, month)),
		),
	);
	return perCard.flat();
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
	const [txs, recurrences, postings, budgets, categories, preferences] = await Promise.all([
		loadSpendingMonth(stores, month, today),
		stores.recurrences.list(),
		stores.recurrences.listPostings(month),
		stores.budgets.list(),
		stores.categories.list(),
		stores.preferences.get(),
	]);
	const active = categories.filter((c) => c.archivedAt === null);
	const bySlug = new Map(active.map((c) => [c.slug, c.id]));
	const outros = active.find((c) => c.slug === "outros") ?? null;
	const originals = await refundOriginalsOutside(stores, txs);
	const toCore = (t: TransactionRecord) => toCoreTransaction(t, outros?.id ?? null, bySlug);
	const raw = summarizeMonth([...txs, ...originals].map(toCore), month);

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
			alert: passedThreshold({
				limitCents: b.limitCents,
				spentCents,
				thresholdPercent: preferences.budgetAlertPercent,
			}),
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
		budgetAlertPercent: preferences.budgetAlertPercent,
		summary: {
			spentCents: raw.spentCents,
			incomeCents: raw.incomeCents,
			investedCents: raw.investedCents,
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

/**
 * "Como chegamos nesse número": o mesmo conjunto do Gasto (`loadSpendingMonth`) e a mesma soma (`summarizeMonth`), com
 * cada linha que pesou, de que ramo veio (conta ou cartão, por cartão) e quanto somou. Serve para o
 * dono (e para a gente) conferir o que entrou, sem recalcular nada fora do engine.
 */
export async function spendingBreakdown(
	stores: Stores,
	month: MonthKey,
	today: LocalDate,
): Promise<SpendingBreakdownResponse> {
	const [txs, categories] = await Promise.all([
		loadSpendingMonth(stores, month, today),
		stores.categories.list(),
	]);
	const active = categories.filter((c) => c.archivedAt === null);
	const bySlug = new Map(active.map((c) => [c.slug, c.id]));
	const outros = active.find((c) => c.slug === "outros") ?? null;
	const originals = await refundOriginalsOutside(stores, txs);
	const toCore = (t: TransactionRecord) => toCoreTransaction(t, outros?.id ?? null, bySlug);
	const summary = summarizeMonth([...txs, ...originals].map(toCore), month);

	const branchOf = (t: TransactionRecord): SpendingBranch => (t.cardId !== null ? "card" : "account");
	const rows = txs
		.filter((t) => (t.kind === "expense" || t.kind === "refund") && t.budgetMonth === month)
		.map((t) => ({
			id: t.id,
			branch: branchOf(t),
			date: t.date,
			invoiceMonth: t.invoiceMonth,
			budgetMonth: t.budgetMonth,
			kind: t.kind,
			description: t.description,
			amountCents: t.amountCents,
			deltaCents: t.kind === "refund" ? -t.amountCents : t.amountCents,
			categoryId: categoryForSummary(t, outros?.id ?? null, bySlug),
			cardId: t.cardId,
			accountId: t.accountId,
			status: t.status,
		}))
		.sort(
			(a, b) => a.branch.localeCompare(b.branch) || b.date.localeCompare(a.date) || a.id.localeCompare(b.id),
		);
	const branches = (["account", "card"] as const).map((branch) => {
		const own = rows.filter((r) => r.branch === branch);
		return { branch, count: own.length, subtotalCents: sum(own.map((r) => r.deltaCents)) };
	});
	const cardList = await stores.cards.list();
	const cards = cardList.flatMap((card) => {
		const own = rows.filter((r) => r.branch === "card" && r.cardId === card.id);
		return own.length === 0
			? []
			: [
					{
						cardId: card.id,
						name: card.name,
						last4: card.last4,
						count: own.length,
						subtotalCents: sum(own.map((r) => r.deltaCents)),
					},
				];
	});
	return {
		month,
		spentCents: summary.spentCents,
		rowsCents: sum(rows.map((r) => r.deltaCents)),
		branches,
		cards,
		rows,
	};
}

const ESTIMATED_NOTE = "Estimada: o banco ainda não lançou esta parcela.";
const EPOCH = new Date(0);

/** Linhas só da resposta da fatura: a parcela que ainda vai cair neste mês, sem gravar lançamento. */
function projectedRows(
	groups: readonly InstallmentGroupRecord[],
	cardId: string,
	month: MonthKey,
	date: LocalDate,
	/** Os lançamentos reais do cartão na fatura de `month`: o que já veio não se estima. */
	real: readonly TransactionRecord[],
): TransactionRecord[] {
	return projectMissingInstallments(groups, cardId, month, real).map((item) => ({
		id: `${PROJECTED_ID_PREFIX}${item.number}-${item.groupId}`.slice(0, 64),
		kind: "expense" as const,
		amountCents: item.amountCents,
		date,
		description: item.description,
		categoryId: item.categoryId,
		accountId: null,
		cardId,
		counterpartAccountId: null,
		refundOfId: null,
		budgetMonth: month,
		invoiceMonth: month,
		installmentGroupId: item.groupId,
		installmentNumber: item.number,
		installmentCount: item.count,
		status: "confirmed" as const,
		source: "import" as const,
		externalId: null,
		note: ESTIMATED_NOTE,
		sourceCategory: null,
		merchantName: null,
		categoryEditedByOwner: false,
		splitGroupId: null,
		createdAt: EPOCH,
		updatedAt: EPOCH,
	}));
}

export async function cardInvoice(stores: Stores, cardId: string, month: MonthKey, today: LocalDate) {
	const card = orNotFound(await stores.cards.get(cardId), "Cartão", "o");
	const invoice = invoiceByMonth(month, toCardConfig(card));
	const config = toCardConfig(card);
	const [posted, payments, groups] = await Promise.all([
		stores.transactions.listByInvoice(cardId, month),
		stores.transactions.listCardPayments(cardId, paymentWindow(month, config)),
		// A parcela de dezembro pode ainda não ter lançamento: o grupo visto nos meses anteriores a projeta.
		stores.transactions.listInstallmentGroups(addMonths(month, -71)),
	]);
	const open = invoiceStatus(invoice, today) === "open";
	const txs = [...posted, ...(open ? projectedRows(groups, cardId, month, invoice.closingDate, posted) : [])];
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
