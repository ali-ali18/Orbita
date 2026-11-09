import {
	addMonths,
	budgetStatus,
	type CardPaymentLine,
	type Cents,
	installmentStanding,
	invoiceByMonth,
	invoiceComposition,
	invoiceFor,
	invoiceStatus,
	type LocalDate,
	type MonthKey,
	monthOf,
	type PaymentStatus,
	paidForInvoice,
	paidWithAdvance,
	passedThreshold,
	paymentStatus,
	paymentWindow,
	pendingInMonth,
	projectMissingInstallments,
	projectMonth,
	safeToSpend,
	summarizeMonth,
	type Transaction,
	UNCATEGORIZED,
} from "@orbita/core";
import {
	type CardRecord,
	DataError,
	type InstallmentGroupRecord,
	type Stores,
	TOTAL_BUDGET_SCOPE,
	type TransactionRecord,
	toCardConfig,
	toMonthlyRecurrence,
} from "@orbita/db";
import { PAYMENT_REVIEW_NOTE, suggestSpendingSlug } from "@orbita/ingest";
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
 * Pagamento de fatura que o banco mandou e o Órbita não soube ligar a um cartão (pendente, com a nota de revisão): pode
 * ser a fatura de um cartão que já está no gasto, então ficaria contado duas vezes. Fora do gasto até o dono
 * confirmar (aí vira despesa) ou ligar ao cartão (aí vira pagamento de fatura). Qualquer outro pendente
 * (notificação do banco, possível duplicata) continua contando.
 */
export const isPaymentUnderReview = (t: Pick<TransactionRecord, "status" | "note" | "kind">) =>
	t.kind === "expense" && t.status === "pending" && t.note === PAYMENT_REVIEW_NOTE;

/** O lançamento entra no "Gasto do mês"? (Tudo que `loadSpendingMonth` devolve passa por aqui.) */
export const countsAsSpending = (t: Pick<TransactionRecord, "status" | "note" | "kind">) =>
	!isPaymentUnderReview(t);

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
	return stores.transactions.listByBudgetMonth(month).then((rows) => rows.filter(countsAsSpending));
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
 * O Gasto oficial do mês: o conjunto (`loadSpendingMonth`) e o total que o Início mostra (`summarizeMonth`, já com o
 * abatimento dos estornos). Quem desenha o Gasto de outro jeito (dia a dia, estabelecimentos) parte daqui.
 */
export async function spendingOfMonth(stores: Stores, month: MonthKey, today: LocalDate) {
	const [txs, categories] = await Promise.all([
		loadSpendingMonth(stores, month, today),
		stores.categories.list(),
	]);
	const active = categories.filter((c) => c.archivedAt === null);
	const bySlug = new Map(active.map((c) => [c.slug, c.id]));
	const outros = active.find((c) => c.slug === "outros") ?? null;
	const originals = await refundOriginalsOutside(stores, txs);
	const raw = summarizeMonth(
		[...txs, ...originals].map((t) => toCoreTransaction(t, outros?.id ?? null, bySlug)),
		month,
	);
	return { txs, spentCents: raw.spentCents };
}

/**
 * Início: tudo calculado pelo engine. Lançamento pendente (ainda sem revisão) conta no gasto:
 * a notificação do banco já avisou que o dinheiro saiu. A exceção é o pagamento de fatura em revisão
 * (`isPaymentUnderReview`), que pode ser a fatura de um cartão já contado e fica de fora até o dono revisar.
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
		editedByOwner: false,
		splitGroupId: null,
		bankPending: false,
		providerId: null,
		providerCode: null,
		lastSeenAt: null,
		removedByBankAt: null,
		createdAt: EPOCH,
		updatedAt: EPOCH,
	}));
}

/** O que ainda se deve numa fatura: o total se aberta; o total menos o pago se fechada (nunca negativo). */
export function invoiceOwedCents(
	status: "open" | "closed" | "overdue",
	totalCents: Cents,
	paidCents: Cents,
): Cents {
	return status === "open" ? Math.max(0, totalCents) : Math.max(0, totalCents - paidCents);
}

/**
 * Os meses de fatura que contam como dívida de um cartão: a aberta, a anterior a ela, o mês atual e o anterior do
 * calendário. Fatura mais velha sem pagamento registrado é histórico anterior ao Órbita, não cobrança.
 */
export function consideredInvoiceMonths(card: CardRecord, today: LocalDate): Set<MonthKey> {
	const thisMonth = monthOf(today);
	const openMonth = invoiceFor(today, toCardConfig(card)).month;
	return new Set([addMonths(thisMonth, -1), thisMonth, addMonths(openMonth, -1), openMonth]);
}

export async function cardInvoice(stores: Stores, cardId: string, month: MonthKey, today: LocalDate) {
	const card = orNotFound(await stores.cards.get(cardId), "Cartão", "o");
	const invoice = invoiceByMonth(month, toCardConfig(card));
	const config = toCardConfig(card);
	const previousMonth = addMonths(month, -1);
	const [posted, payments, groups] = await Promise.all([
		stores.transactions.listByInvoice(cardId, month),
		// Da janela da fatura anterior à desta: o pagamento adiantado que sobra da anterior vale para esta.
		stores.transactions.listCardPayments(cardId, {
			from: paymentWindow(addMonths(month, -2), config).from,
			to: paymentWindow(month, config).to,
		}),
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
	// A fatura fechada que o banco informou (o total dele pode diferir da soma dos lançamentos: é o que se paga).
	const bills = open ? [] : await stores.bills.listByCard(cardId);
	const bankTotalOf = (m: MonthKey) =>
		bills
			.filter((b) => monthOf(b.dueDate) === m)
			.sort((a, b) => b.syncedAt.getTime() - a.syncedAt.getTime())[0];
	const bill = open ? undefined : bankTotalOf(month);
	// Os pagamentos que o banco lista (`payments[]` de qualquer fatura) valem pela DATA, na janela de pagamento da
	// fatura (do fechamento ao fechamento seguinte): nem todo banco os põe na fatura seguinte (alguns, na própria).
	const bankPayments = new Map<string, CardPaymentLine>();
	for (const b of bills) {
		b.payments.forEach((p, i) => {
			if (Number.isSafeInteger(p.amountCents) && p.amountCents > 0) {
				bankPayments.set(p.externalId ?? `${b.id}:${i}`, { date: p.date, amountCents: p.amountCents });
			}
		});
	}
	const bankPaidOf = (m: MonthKey) => paidForInvoice([...bankPayments.values()], m, config);
	// Pago = pagamentos de fatura (`card_payment`) atribuídos a esta fatura (regra em `invoice-payment.ts` do core),
	// inclusive o adiantado de antes do fechamento que a fatura anterior, já quitada, não absorveu.
	const previousBill = open ? undefined : bankTotalOf(previousMonth);
	const olderBill = open ? undefined : bankTotalOf(addMonths(month, -2));
	// O total é UM só (o do banco, quando há): paymentStatus, o que falta, o botão de pagar e a IA partem dele.
	const totalCents = bill?.totalAmountCents ?? composition.totalCents;
	const ledgerPaidCents = paidWithAdvance({
		payments,
		month,
		card: config,
		today,
		totalCents,
		// Só o total do banco prova o quanto a anterior (e a de dois meses antes) absorve; a soma dos lançamentos
		// pode ignorar compras de antes do Órbita.
		previousTotalCents: previousBill?.totalAmountCents ?? null,
		olderTotalCents: olderBill?.totalAmountCents ?? null,
		olderPaidCents: bankPaidOf(addMonths(month, -2)),
	});
	// As duas medidas são do mesmo pagamento (o `card_payment` casa com o do banco): vale a maior, nunca a soma.
	// Limitado ao total (como o do ledger): o que passa dele (juros, atraso) não é desta fatura.
	const bankPaidCents = open || !bill ? 0 : Math.min(bankPaidOf(month), Math.max(0, totalCents));
	const paidCents = Math.max(ledgerPaidCents, bankPaidCents);
	let status: PaymentStatus = paymentStatus(invoice, totalCents, paidCents, today);
	// Fechada fora dos meses considerados, sem nenhum pagamento registrado: histórico (anterior ao Órbita), não cobrança.
	if (status === "unpaid" && !consideredInvoiceMonths(card, today).has(month)) status = "history";
	return {
		card,
		bank: bill
			? {
					totalCents: bill.totalAmountCents,
					dueDate: bill.dueDate,
					closeDate: bill.closeDate,
					syncedAt: bill.syncedAt.toISOString(),
				}
			: null,
		invoice: {
			...invoice,
			status: invoiceStatus(invoice, today),
			paidCents,
			// O total que se paga (o do banco, quando há) e o que falta dele: a fonte única para a IA, o endpoint, o
			// botão de pagar e o app, que só exibem.
			totalCents,
			owedCents:
				status === "history" ? 0 : invoiceOwedCents(invoiceStatus(invoice, today), totalCents, paidCents),
			// O total do banco, quando há, é o que se paga: fatura que ele mostra com total 0 está quitada (pagou antes de fechar).
			paymentStatus: status,
		},
		composition,
		transactions: txs,
	};
}

/**
 * Parcelamentos em andamento. `from` é a fatura de referência; com `today`, a de referência de cada cartão é a mais
 * nova entre `from` e a fatura que o cartão tem aberta hoje (cartão que vence no mês seguinte já está na do mês
 * que vem), para a parcela vista da fatura aberta contar como a vigente.
 */
export async function activeInstallments(stores: Stores, from: MonthKey, today?: LocalDate) {
	const [groups, cards] = await Promise.all([
		stores.transactions.listInstallmentGroups(from),
		today === undefined ? Promise.resolve([]) : stores.cards.list(),
	]);
	const openMonth = new Map(
		cards.map((c) => [c.id, invoiceFor(today as LocalDate, toCardConfig(c)).month] as const),
	);
	return groups.map((g) => {
		const open = openMonth.get(g.installments[0]?.cardId ?? "");
		return installmentGroupView(g, open !== undefined && open > from ? open : from, from);
	});
}

/**
 * Parcelamento como o app o mostra: tudo pela parcela vista (n/N), ver `installmentStanding` no engine. Pago, falta,
 * comprometido no mês e "última parcela em" vêm prontos; `paidEstimated`/`remainingEstimated` dizem quando parte do
 * número é estimativa (parcelas que o Órbita nunca viu).
 */
function installmentGroupView(group: InstallmentGroupRecord, refMonth: MonthKey, from: MonthKey) {
	const first = group.installments[0];
	const last = group.installments.at(-1);
	const count = last?.installmentCount ?? first?.installmentCount ?? group.installments.length;
	const standing = installmentStanding(
		group.installments.map((t) => ({
			number: t.installmentNumber ?? 0,
			count: t.installmentCount ?? 0,
			amountCents: t.amountCents,
			invoiceMonth: t.invoiceMonth ?? t.budgetMonth,
		})),
		count,
		refMonth,
		from,
	);
	return {
		groupId: group.groupId,
		description: first?.description ?? "",
		cardId: first?.cardId ?? null,
		...standing,
		installments: group.installments,
	};
}
