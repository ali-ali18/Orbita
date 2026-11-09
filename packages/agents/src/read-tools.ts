import { addMonths, clampDayInMonth, formatBRL, type MonthKey, parseBRL } from "@orbita/core";
import type { ChatRowsCard, MonthSummaryResponse, TransactionDto } from "@orbita/shared";
import { z } from "zod";
import { monthLabel } from "./alerts/text.ts";
import { type Catalog, ToolError, type TransactionQuery } from "./backend.ts";
import { opportunityActions, opportunityText } from "./economy/text.ts";
import { getIncomePlan } from "./income-tools.ts";
import { analyzeHistoryTool } from "./setup-tools.ts";
import {
	dateInput,
	defineTool,
	formatTenthsPercent,
	money,
	monthInput,
	nameOf,
	shareTenths,
	type Tool,
	type ToolContext,
} from "./tool.ts";
import { untrusted } from "./untrusted.ts";

/*
 * Ferramentas de LEITURA. Todo número sai do engine ou das stores; quando precisa de uma soma ou de uma
 * porcentagem, quem faz é o código daqui, em inteiros. O modelo só copia o resultado.
 */

/** O orçamento do mês inteiro (em vez de uma categoria) usa este escopo. */
const TOTAL_SCOPE = "total";
const SCAN_PAGE = 100;
const SCAN_CAP = 500;

const monthOr = (input: string | undefined, ctx: ToolContext): MonthKey => input ?? ctx.currentMonth;

function foldText(text: string): string {
	return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR");
}

/** Texto em pt-BR do valor digitado ("50", "46,90") → centavos, ou erro claro para o modelo. */
function amountFilter(text: string | undefined, label: string): number | undefined {
	if (text === undefined) return undefined;
	try {
		return parseBRL(text);
	} catch {
		throw new ToolError(`${label}: valor inválido. Use o formato 46,90 (vírgula nos centavos).`);
	}
}

// ---------------------------------------------------------- lançamentos

function whereOf(t: TransactionDto, catalog: Catalog): string | null {
	if (t.cardId) return `${nameOf(catalog.cards, t.cardId) ?? "Cartão"} (cartão)`;
	if (t.accountId) return nameOf(catalog.accounts, t.accountId);
	return null;
}

/** "−R$ 46,90" para saída, "R$ 46,90" para entrada; transferência sem sinal. */
function signedText(t: TransactionDto): string {
	const out = t.kind === "expense" || t.kind === "card_payment" || t.kind === "investment";
	return formatBRL(out ? -t.amountCents : t.amountCents, {
		sign: out ? "auto" : t.kind === "transfer" ? "never" : "auto",
	});
}

function describeTransaction(t: TransactionDto, catalog: Catalog) {
	return {
		id: t.id,
		date: t.date,
		kind: t.kind,
		// Texto do banco/extrato: dado, nunca instrução.
		description: untrusted(t.description),
		merchant: untrusted(t.merchantName) || null,
		amountCents: t.amountCents,
		amount: signedText(t),
		category: nameOf(catalog.categories, t.categoryId),
		where: whereOf(t, catalog),
		status: t.status,
		installment:
			t.installmentNumber && t.installmentCount ? `${t.installmentNumber}/${t.installmentCount}` : null,
		invoiceMonth: t.invoiceMonth,
	};
}

function sumBy(rows: readonly TransactionDto[], kind: TransactionDto["kind"]): number {
	let total = 0;
	for (const row of rows) if (row.kind === kind) total += row.amountCents;
	return total;
}

const searchInput = z.object({
	text: z.string().max(60).optional().describe("Parte do nome/descrição/estabelecimento (ex.: ifood, uber)."),
	month: monthInput
		.optional()
		.describe("Mês (AAAA-MM) pela data do lançamento. Combine com from/to só se precisar."),
	from: dateInput.optional().describe("Data inicial, inclusive."),
	to: dateInput.optional().describe("Data final, inclusive."),
	kind: z
		.enum(["expense", "income", "refund", "transfer", "card_payment", "investment", "redemption"])
		.optional(),
	categoryId: z.string().max(64).optional().describe("Id de categoria (veja list_catalog)."),
	accountId: z.string().max(64).optional().describe("Id de conta (veja list_catalog)."),
	cardId: z.string().max(64).optional().describe("Id de cartão (veja list_catalog)."),
	status: z.enum(["pending", "confirmed"]).optional(),
	minAmount: z.string().max(20).optional().describe('Valor mínimo em reais, ex.: "50,00".'),
	maxAmount: z.string().max(20).optional().describe('Valor máximo em reais, ex.: "200,00".'),
	limit: z.number().int().min(1).max(30).default(15).describe("Quantos lançamentos mostrar (1 a 30)."),
});

/** "Santander · 01/10/2026 a 31/10/2026": o recorte de uma busca, em palavras (vazio = sem filtro de conta nem de data). */
function scopeOf(
	input: z.infer<typeof searchInput>,
	from: string | undefined,
	to: string | undefined,
	catalog: Catalog,
): string[] {
	const br = (d: string) => d.split("-").reverse().join("/");
	const parts: string[] = [];
	if (input.accountId) parts.push(untrusted(nameOf(catalog.accounts, input.accountId), 30) || "conta");
	if (input.cardId) parts.push(`${untrusted(nameOf(catalog.cards, input.cardId), 30) || "Cartão"} (cartão)`);
	if (input.categoryId)
		parts.push(untrusted(nameOf(catalog.categories, input.categoryId), 30) || "categoria");
	if (from && to) parts.push(`${br(from)} a ${br(to)}`);
	else if (from) parts.push(`desde ${br(from)}`);
	else if (to) parts.push(`até ${br(to)}`);
	return parts;
}

export const searchTransactions = defineTool({
	name: "search_transactions",
	label: "Procurando lançamentos…",
	access: "read",
	description:
		"Lista e busca lançamentos (gastos, receitas, parcelas…) com filtros. Devolve as linhas mais recentes e os TOTAIS " +
		"já somados de tudo que casou (despesas, receitas, estornos). Use sempre que o dono perguntar quanto gastou com " +
		"algo, em um período, num estabelecimento, numa categoria, conta ou cartão. Nunca some linhas por conta própria. " +
		"Para CONFERIR um extrato ou fatura anexado: filtre SEMPRE pela conta (ou cartão) do documento e pelo período dele " +
		"(from/to), com os ids de list_catalog; sem isso o resultado mistura todas as contas e o card mostra lançamentos " +
		"que não têm a ver com o documento.",
	input: searchInput,
	async run(input, ctx) {
		const catalog = await ctx.catalog();
		let from = input.from;
		let to = input.to;
		if (input.month) {
			from = from ?? `${input.month}-01`;
			to = to ?? clampDayInMonth(input.month, 31);
		}
		if (from && to && from > to) throw new ToolError("A data inicial não pode ser depois da final.");
		const minCents = amountFilter(input.minAmount, "Valor mínimo");
		const maxCents = amountFilter(input.maxAmount, "Valor máximo");
		const base: Omit<TransactionQuery, "cursor"> = {
			from,
			to,
			kinds: input.kind ? [input.kind] : undefined,
			categoryIds: input.categoryId ? [input.categoryId] : undefined,
			accountIds: input.accountId ? [input.accountId] : undefined,
			cardIds: input.cardId ? [input.cardId] : undefined,
			statuses: input.status ? [input.status] : undefined,
			minCents,
			maxCents,
			limit: SCAN_PAGE,
		};
		const words = input.text ? foldText(input.text).split(/\s+/).filter(Boolean) : [];
		const matched: TransactionDto[] = [];
		let cursor: string | undefined;
		let scanned = 0;
		let more = false;
		do {
			const page = await ctx.reader.listTransactions({ ...base, cursor });
			scanned += page.transactions.length;
			for (const t of page.transactions) {
				if (words.length > 0) {
					const haystack = foldText(
						`${t.description} ${t.merchantName ?? ""} ${t.sourceCategory ?? ""} ${nameOf(catalog.categories, t.categoryId) ?? ""}`,
					);
					if (!words.every((w) => haystack.includes(w))) continue;
				}
				matched.push(t);
			}
			cursor = page.nextCursor ?? undefined;
			more = cursor !== undefined;
		} while (cursor !== undefined && scanned < SCAN_CAP);

		const shown = matched.slice(0, input.limit);
		const scope = scopeOf(input, from, to, catalog);
		const unfilteredByAccount = !input.accountId && !input.cardId;
		const expensesCents = sumBy(matched, "expense");
		const incomeCents = sumBy(matched, "income");
		const refundsCents = sumBy(matched, "refund");
		const card: ChatRowsCard = {
			type: "rows",
			tool: "search_transactions",
			// O título diz o que foi consultado (conta, cartão, período): o card tem de corresponder ao que a IA olhou.
			title: [input.text ? `Lançamentos: ${untrusted(input.text, 30)}` : "Lançamentos", ...scope].join(" · "),
			rows: shown.slice(0, 8).map((t) => {
				const info = describeTransaction(t, catalog);
				return {
					label: info.description || "Sem descrição",
					caption: [t.date.split("-").reverse().join("/"), info.category, info.where]
						.filter(Boolean)
						.join(" · "),
					value: info.amount,
					cents: t.amountCents,
				};
			}),
			total:
				matched.length === 0
					? null
					: {
							label: `${matched.length} lançamento${matched.length === 1 ? "" : "s"}, gastos`,
							value: formatBRL(expensesCents),
						},
		};
		return {
			data: {
				matchedCount: matched.length,
				shownCount: shown.length,
				// O que esta consulta cobre (a IA diz isto ao dono, e o card mostra o mesmo).
				scope: scope.length > 0 ? scope.join(" · ") : "todos os lançamentos, de todas as contas e cartões",
				...(unfilteredByAccount && catalog.accounts.length + catalog.cards.length > 1
					? {
							warning:
								"Sem filtro de conta/cartão: o resultado mistura todas as contas. Para conferir um extrato ou fatura, " +
								"chame de novo com accountId (ou cardId) e o período do documento.",
						}
					: {}),
				// Se a lista é maior que a varredura, os totais valem só para o que foi visto.
				totalsAreComplete: !more,
				totals: {
					expenses: money(expensesCents),
					income: money(incomeCents),
					refunds: money(refundsCents),
				},
				transactions: shown.map((t) => describeTransaction(t, catalog)),
			},
			card,
		};
	},
});

// ---------------------------------------------------------- resumo do mês

function categoryRows(summary: MonthSummaryResponse, catalog: Catalog) {
	const spent = summary.summary.spentCents;
	return Object.entries(summary.summary.byCategory)
		.filter(([, cents]) => cents > 0)
		.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
		.map(([id, cents]) => {
			const tenths = shareTenths(cents, spent);
			return {
				categoryId: id,
				name: nameOf(catalog.categories, id) ?? "Sem categoria",
				...money(cents),
				share: tenths === null ? null : formatTenthsPercent(tenths),
				shareTenths: tenths,
			};
		});
}

export const getMonthSummary = defineTool({
	name: "get_month_summary",
	label: "Consultando o resumo do mês…",
	access: "read",
	description:
		"Resumo do mês calculado pelo engine: gasto, entradas, investido, quanto ainda dá para gastar, projeção de " +
		"fechamento, recorrências que ainda vão cair e o gasto por categoria. O gasto do cartão conta no mês em que a " +
		"fatura VENCE (cada parcela na sua fatura); débito, Pix e boleto contam pela data. O investido (dinheiro " +
		"aplicado em ações, CDB, cripto…) NÃO é gasto: informe-o à parte. Use para 'como está o mês', 'quanto gastei', " +
		"'dá pra gastar quanto', 'como fecha o mês'.",
	input: z.object({ month: monthInput.optional() }),
	async run(input, ctx) {
		const month = monthOr(input.month, ctx);
		const [summary, catalog] = await Promise.all([ctx.reader.monthSummary(month), ctx.catalog()]);
		const s = summary.summary;
		const resultCents = s.incomeCents - s.spentCents;
		const rows: ChatRowsCard["rows"] = [
			{ label: "Entradas", caption: null, value: formatBRL(s.incomeCents), cents: s.incomeCents },
			{ label: "Gastos", caption: null, value: formatBRL(s.spentCents), cents: s.spentCents },
		];
		if (s.investedCents > 0) {
			rows.push({
				label: "Investido",
				caption: "não conta como gasto",
				value: formatBRL(s.investedCents),
				cents: s.investedCents,
			});
		}
		if (summary.projection) {
			rows.push({
				label: "Projeção do mês",
				caption: summary.projection.lowConfidence ? "estimativa com pouco histórico" : null,
				value: formatBRL(summary.projection.projectedCents),
				cents: summary.projection.projectedCents,
			});
		}
		if (summary.safeToSpend) {
			rows.push({
				label: "Ainda dá para gastar",
				caption: `${formatBRL(summary.safeToSpend.perDayCents)} por dia`,
				value: formatBRL(summary.safeToSpend.availableCents),
				cents: Math.max(0, summary.safeToSpend.availableCents),
			});
		}
		return {
			data: {
				month,
				isCurrentMonth: month === ctx.currentMonth,
				spent: money(s.spentCents),
				income: money(s.incomeCents),
				invested: money(s.investedCents),
				refundCredit: money(s.refundCreditCents),
				incomeMinusSpent: money(resultCents),
				safeToSpend: summary.safeToSpend
					? {
							available: money(summary.safeToSpend.availableCents),
							perDay: money(summary.safeToSpend.perDayCents),
							remainingDays: summary.safeToSpend.remainingDays,
						}
					: null,
				projection: summary.projection
					? {
							projected: money(summary.projection.projectedCents),
							lowConfidence: summary.projection.lowConfidence,
						}
					: null,
				pendingRecurring: {
					expenses: money(summary.pendingRecurring.expenseCents),
					income: money(summary.pendingRecurring.incomeCents),
				},
				topCategories: categoryRows(summary, catalog).slice(0, 8),
			},
			card: {
				type: "rows",
				tool: "get_month_summary",
				title: `Resumo de ${monthLabel(month)}`,
				rows,
				total: null,
			},
		};
	},
});

// ---------------------------------------------------------------- orçamento

export const getBudgetStatus = defineTool({
	name: "get_budget_status",
	label: "Conferindo o orçamento…",
	access: "read",
	description:
		"Situação dos orçamentos do mês: limite, gasto, quanto sobra e se estourou, por categoria e no total. " +
		"Use para 'estou dentro do orçamento', 'quanto sobra em delivery', 'o que estourou'.",
	input: z.object({ month: monthInput.optional() }),
	async run(input, ctx) {
		const month = monthOr(input.month, ctx);
		const [summary, catalog] = await Promise.all([ctx.reader.monthSummary(month), ctx.catalog()]);
		const budgets = summary.budgets.map((b) => {
			const percent = b.ratio === null ? null : Math.round(b.ratio * 100);
			return {
				scope: b.scope,
				name:
					b.scope === TOTAL_SCOPE ? "Orçamento do mês" : (nameOf(catalog.categories, b.scope) ?? "Categoria"),
				limit: money(b.limitCents),
				spent: money(b.spentCents),
				remaining: money(b.remainingCents),
				percentUsed: percent,
				overBudget: b.overBudget,
				// Passou do percentual de aviso das preferências do dono.
				warning: b.alert,
			};
		});
		return {
			data: { month, warningPercent: summary.budgetAlertPercent, hasBudgets: budgets.length > 0, budgets },
			card: {
				type: "rows",
				tool: "get_budget_status",
				title: `Orçamento de ${monthLabel(month)}`,
				rows: budgets.map((b) => ({
					label: b.name,
					caption: `${b.spent.text} de ${b.limit.text}${b.overBudget ? " · estourou" : b.warning ? " · perto do limite" : ""}`,
					value: b.percentUsed === null ? "—" : `${b.percentUsed}%`,
					cents: b.spent.cents,
				})),
				total: null,
			},
		};
	},
});

// ------------------------------------------------------------------- fatura

export const getCardInvoice = defineTool({
	name: "get_card_invoice",
	label: "Abrindo a fatura…",
	access: "read",
	description:
		"Fatura de um cartão: vencimento, fechamento, total, quanto já foi pago e as compras. O mês é o do VENCIMENTO " +
		"da fatura (AAAA-MM). Sem cartão informado, usa o único cartão ativo; havendo vários, peça ao dono qual " +
		"(os ids estão em list_catalog).",
	input: z.object({
		cardId: z.string().max(64).optional(),
		month: monthInput.optional(),
	}),
	async run(input, ctx) {
		const catalog = await ctx.catalog();
		let cardId = input.cardId;
		if (!cardId) {
			if (catalog.cards.length === 1 && catalog.cards[0]) cardId = catalog.cards[0].id;
			else if (catalog.cards.length === 0) throw new ToolError("Não há cartão cadastrado.");
			else {
				throw new ToolError(
					`Informe o cartão. Cartões: ${catalog.cards.map((c) => `${untrusted(c.name, 40)} (id ${c.id})`).join("; ")}.`,
				);
			}
		}
		const month = monthOr(input.month, ctx);
		const invoice = await ctx.reader.cardInvoice(cardId, month);
		const remainingCents = invoice.owedCents;
		const purchases = [...invoice.transactions]
			.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
			.slice(0, 15)
			.map((t) => describeTransaction(t, catalog));
		const c = invoice.composition;
		return {
			data: {
				card: untrusted(invoice.card.name, 40),
				month: invoice.month,
				closingDate: invoice.closingDate,
				dueDate: invoice.dueDate,
				// Fatura antiga sem pagamento registrado: não é cobrança, então nem "vencida" nem "não paga".
				status: invoice.paymentStatus === "history" ? "history" : invoice.status,
				paymentStatus: invoice.paymentStatus,
				total: money(invoice.totalCents),
				paid: money(invoice.paidCents),
				remaining: money(remainingCents),
				composition: {
					purchases: money(c.purchasesCents),
					installments: money(c.installmentsCents),
					recurring: money(c.recurringCents),
					refunds: money(c.refundsCents),
				},
				purchaseCount: invoice.transactions.length,
				latestPurchases: purchases,
			},
			card: {
				type: "rows",
				tool: "get_card_invoice",
				title: `Fatura ${untrusted(invoice.card.name, 30)} · vence ${invoice.dueDate.split("-").reverse().join("/")}`,
				rows: [
					{ label: "Compras", caption: null, value: formatBRL(c.purchasesCents), cents: c.purchasesCents },
					{
						label: "Parcelas",
						caption: null,
						value: formatBRL(c.installmentsCents),
						cents: c.installmentsCents,
					},
					{
						label: "Recorrentes",
						caption: null,
						value: formatBRL(c.recurringCents),
						cents: c.recurringCents,
					},
					{ label: "Já pago", caption: null, value: formatBRL(invoice.paidCents), cents: invoice.paidCents },
				],
				total: { label: "Total da fatura", value: formatBRL(invoice.totalCents) },
			},
		};
	},
});

// ------------------------------------------------------------ assinaturas

/** Cobranças mensais achadas no histórico que ainda não são assinatura cadastrada (sugestões). */
export const listSubscriptions = defineTool({
	name: "list_subscriptions",
	label: "Listando as assinaturas…",
	access: "read",
	description:
		"Assinaturas e recorrências do dono. O campo `totals` (o primeiro do resultado) já traz TODAS as somas prontas, " +
		"em centavos e em texto: `totals.registeredExpensesPerMonth` (só as cadastradas), `totals.suggestedPerMonth` (só " +
		"as detectadas) e `totals.registeredPlusSuggestedPerMonth` (cadastradas + detectadas: o total geral por mês). " +
		"Copie o `text` do total que o dono pediu; NUNCA some itens por conta própria. `subscriptions` são as " +
		"CADASTRADAS e `detectedSuggestions` as DETECTADAS no histórico (cobranças mensais que ainda não estão " +
		"cadastradas); em cada item, `name` é o nome do app (use-o; `merchant` é o texto cru do banco). Para o total de " +
		"só ALGUNS itens (ex.: 'sem o YouTube', 'só as de IA'), chame de novo com `keys` (as `key` das detectadas e/ou " +
		"os `id` das cadastradas): `totals.selectedPerMonth` traz a soma. Use SEMPRE esta ferramenta para 'quanto tenho " +
		"em assinatura', 'minhas assinaturas' ou 'o que pago todo mês'. As sugestões não são certeza: diga que foram " +
		"achadas no histórico e ofereça cadastrá-las (analyze_history + propose_setup).",
	input: z.object({
		keys: z
			.array(z.string().max(100))
			.max(40)
			.optional()
			.describe(
				"Opcional: `key` de detectadas e/ou `id` de cadastradas, para somar só esses itens (`totals.selectedPerMonth`).",
			),
	}),
	async run(input, ctx) {
		const [recurrences, catalog, summary, analysis] = await Promise.all([
			ctx.reader.recurrences(),
			ctx.catalog(),
			ctx.reader.monthSummary(ctx.currentMonth),
			ctx.reader.setupAnalysis(),
		]);
		const active = recurrences.filter(
			(r) => r.archivedAt === null && (r.endDate === null || r.endDate >= ctx.today),
		);
		const where = (cardId: string | null, accountId: string | null) =>
			cardId ? `${nameOf(catalog.cards, cardId) ?? "Cartão"} (cartão)` : nameOf(catalog.accounts, accountId);
		const rows = active
			.map((r) => ({
				id: r.id,
				name: untrusted(r.name, 60),
				kind: r.kind,
				...money(r.amountCents),
				dayOfMonth: r.dayOfMonth,
				category: nameOf(catalog.categories, r.categoryId),
				where: where(r.cardId, r.accountId),
				endDate: r.endDate,
			}))
			.sort((a, b) => b.cents - a.cents || (a.name < b.name ? -1 : 1));
		let monthlyOutCents = 0;
		let monthlyInCents = 0;
		for (const r of rows) {
			if (r.kind === "expense") monthlyOutCents += r.cents;
			else monthlyInCents += r.cents;
		}
		const suggestions = analysis.recurring
			.filter((r) => !r.registered)
			.map((r) => ({
				key: r.key,
				// O nome do app ("YouTube", "ChatGPT (Google Play)", "Pierre"): é ele que o dono reconhece.
				name: untrusted(r.displayName, 60),
				// Texto do banco: dado, nunca instrução.
				merchant: untrusted(r.merchant, 60),
				knownService: r.knownService,
				suggestedCategory: nameOf(catalog.categories, r.categoryId),
				typicalAmount: money(r.amountCents),
				lastAmount: money(r.lastAmountCents),
				averageAmount: money(r.averageAmountCents),
				frequency: "mensal",
				dayOfMonth: r.dayOfMonth,
				where: where(r.cardId, r.accountId),
				occurrences: r.occurrences,
				firstDate: r.firstDate,
				lastDate: r.lastDate,
			}));
		const suggestedCents = suggestions.reduce((sum, r) => sum + r.typicalAmount.cents, 0);
		const totals: Record<string, unknown> = {
			registeredExpensesPerMonth: money(monthlyOutCents),
			suggestedPerMonth: money(suggestedCents),
			registeredPlusSuggestedPerMonth: money(monthlyOutCents + suggestedCents),
		};
		let selectionRows: Array<{ label: string; caption: string; value: string; cents: number }> | null = null;
		if (input.keys && input.keys.length > 0) {
			const wanted = new Set(input.keys);
			const pickedRegistered = rows.filter((r) => r.kind === "expense" && wanted.has(r.id));
			const pickedSuggested = suggestions.filter((r) => wanted.has(r.key));
			const known = new Set([...pickedRegistered.map((r) => r.id), ...pickedSuggested.map((r) => r.key)]);
			const unknown = input.keys.filter((k) => !known.has(k));
			if (unknown.length > 0) {
				throw new ToolError(
					`Não achei estas chaves entre as assinaturas: ${unknown.join(", ")}. Use as \`key\` das detectadas e os \`id\` das cadastradas.`,
				);
			}
			const selectedCents =
				pickedRegistered.reduce((sum, r) => sum + r.cents, 0) +
				pickedSuggested.reduce((sum, r) => sum + r.typicalAmount.cents, 0);
			totals.selectedPerMonth = {
				...money(selectedCents),
				items: [...pickedRegistered.map((r) => r.name), ...pickedSuggested.map((r) => r.name)],
			};
			selectionRows = [
				...pickedRegistered.map((r) => ({
					label: r.name,
					caption: `dia ${r.dayOfMonth}${r.where ? ` · ${r.where}` : ""}`,
					value: r.text,
					cents: r.cents,
				})),
				...pickedSuggested.map((r) => ({
					label: `${r.name} (detectada)`,
					caption: `dia ${r.dayOfMonth}${r.where ? ` · ${r.where}` : ""} · ${r.occurrences}x`,
					value: r.typicalAmount.text,
					cents: r.typicalAmount.cents,
				})),
			];
			if (selectionRows.length === 0)
				throw new ToolError("Nenhum item escolhido é uma assinatura de despesa.");
			totals.selectedPerMonth = {
				...(totals.selectedPerMonth as object),
				count: selectionRows.length,
			};
		}
		return {
			data: {
				// Primeiro: é daqui que se copia qualquer total.
				totals,
				count: rows.length,
				monthlyExpenses: money(monthlyOutCents),
				monthlyIncome: money(monthlyInCents),
				stillToPostThisMonth: {
					expenses: money(summary.pendingRecurring.expenseCents),
					income: money(summary.pendingRecurring.incomeCents),
				},
				subscriptions: rows,
				detectedSuggestions: suggestions,
				detectedPeriod: { from: analysis.from, to: analysis.to, monthsWithData: analysis.monthsOfHistory },
				limitedHistory: analysis.limitedHistory,
			},
			card: {
				type: "rows",
				tool: "list_subscriptions",
				title: selectionRows ? "Assinaturas escolhidas" : "Assinaturas e recorrências",
				rows: selectionRows ?? [
					...rows
						.filter((r) => r.kind === "expense")
						.slice(0, 10)
						.map((r) => ({
							label: r.name,
							caption: `dia ${r.dayOfMonth}${r.where ? ` · ${r.where}` : ""}`,
							value: r.text,
							cents: r.cents,
						})),
					...suggestions.slice(0, 10).map((r) => ({
						label: `${r.name} (detectada)`,
						caption: `dia ${r.dayOfMonth}${r.where ? ` · ${r.where}` : ""} · ${r.occurrences}x`,
						value: r.typicalAmount.text,
						cents: r.typicalAmount.cents,
					})),
				],
				total: selectionRows
					? {
							label: "Por mês (só os escolhidos)",
							value: (totals.selectedPerMonth as { text: string }).text,
						}
					: {
							label: "Por mês (cadastradas + detectadas)",
							value: formatBRL(monthlyOutCents + suggestedCents),
						},
			},
		};
	},
});

// ------------------------------------------------------------------ metas

const GOAL_STATUS_TEXT: Record<string, string> = {
	reached: "alcançada",
	no_deadline: "sem prazo",
	on_track: "no ritmo",
	behind: "atrasada",
};

export const getGoalsStatus = defineTool({
	name: "goals_status",
	label: "Olhando as metas…",
	access: "read",
	description:
		"Metas de guardar dinheiro (viagem, reserva de emergência…): quanto já foi guardado, quanto falta, percentual, " +
		"prazo, quanto guardar por mês e a situação (alcançada, no ritmo, atrasada, sem prazo), mais o total guardado. " +
		"Use para 'como estão minhas metas', 'quanto falta para a viagem'.",
	input: z.object({}),
	async run(_input, ctx) {
		const { goals, totals } = await ctx.reader.goals();
		const rows = goals.map((g) => ({
			id: g.id,
			name: untrusted(g.name, 60),
			target: money(g.targetCents),
			saved: money(g.savedCents),
			remaining: money(g.remainingCents),
			percent: g.percent,
			deadline: g.deadline,
			monthsLeft: g.monthsLeft,
			monthlyNeeded: g.monthlyNeededCents === null ? null : money(g.monthlyNeededCents),
			projectedDate: g.projectedDate,
			status: g.status,
			statusText: GOAL_STATUS_TEXT[g.status] ?? g.status,
		}));
		return {
			data: {
				count: rows.length,
				totalSaved: money(totals.savedCents),
				totalTarget: money(totals.targetCents),
				goals: rows,
			},
			card: {
				type: "rows",
				tool: "goals_status",
				title: "Metas",
				rows: rows.slice(0, 10).map((r) => ({
					label: r.name,
					caption: `${r.percent}% · ${r.statusText}${r.deadline ? ` · até ${r.deadline.split("-").reverse().join("/")}` : ""}`,
					value: r.saved.text,
					cents: r.saved.cents,
				})),
				total: { label: "Total guardado", value: formatBRL(totals.savedCents) },
			},
		};
	},
});

// ------------------------------------------------- categorias e relatório

export const getCategoryBreakdown = defineTool({
	name: "get_category_breakdown",
	label: "Separando por categoria…",
	access: "read",
	description:
		"Gasto do mês por categoria, do maior para o menor, com a fatia (%) de cada uma no total. Use para 'em que " +
		"mais gastei', 'quanto foi para mercado', 'onde vai meu dinheiro'.",
	input: z.object({ month: monthInput.optional() }),
	async run(input, ctx) {
		const month = monthOr(input.month, ctx);
		const [summary, catalog] = await Promise.all([ctx.reader.monthSummary(month), ctx.catalog()]);
		const rows = categoryRows(summary, catalog);
		return {
			data: { month, spent: money(summary.summary.spentCents), categories: rows },
			card: {
				type: "rows",
				tool: "get_category_breakdown",
				title: `Gastos por categoria · ${monthLabel(month)}`,
				rows: rows
					.slice(0, 10)
					.map((r) => ({ label: r.name, caption: r.share, value: r.text, cents: r.cents })),
				total: { label: "Total", value: formatBRL(summary.summary.spentCents) },
			},
		};
	},
});

export const getMonthReport = defineTool({
	name: "get_month_report",
	label: "Montando o relatório do mês…",
	access: "read",
	description:
		"Relatório do mês comparado com o mês anterior: gastos, entradas, resultado, variação de cada uma das maiores " +
		"categorias, orçamentos estourados e projeção. Use para 'resumo do mês', 'como me saí', 'comparar com o mês " +
		"passado'. Se o mês ainda não acabou, a comparação com o mês anterior inteiro pede cuidado: diga isso.",
	input: z.object({ month: monthInput.optional() }),
	async run(input, ctx) {
		const month = monthOr(input.month, ctx);
		const previous = addMonths(month, -1);
		const [now, before, catalog] = await Promise.all([
			ctx.reader.monthSummary(month),
			ctx.reader.monthSummary(previous),
			ctx.catalog(),
		]);
		const change = (current: number, prior: number) => {
			const tenths = prior > 0 ? Math.round(((current - prior) * 1000) / prior) : null;
			return {
				previous: money(prior),
				delta: money(current - prior),
				deltaPercent: tenths === null ? null : formatTenthsPercent(tenths),
			};
		};
		const priorByCategory = before.summary.byCategory;
		const top = categoryRows(now, catalog)
			.slice(0, 5)
			.map((c) => ({ ...c, vsPrevious: change(c.cents, priorByCategory[c.categoryId] ?? 0) }));
		const overBudget = now.budgets
			.filter((b) => b.overBudget)
			.map((b) => ({
				name:
					b.scope === TOTAL_SCOPE ? "Orçamento do mês" : (nameOf(catalog.categories, b.scope) ?? "Categoria"),
				over: money(Math.max(0, b.spentCents - b.limitCents)),
			}));
		const spentChange = change(now.summary.spentCents, before.summary.spentCents);
		const incomeChange = change(now.summary.incomeCents, before.summary.incomeCents);
		const rows: ChatRowsCard["rows"] = [
			{
				label: "Gastos",
				caption: spentChange.deltaPercent ? `${spentChange.deltaPercent} vs. mês anterior` : null,
				value: formatBRL(now.summary.spentCents),
				cents: now.summary.spentCents,
			},
			{
				label: "Entradas",
				caption: incomeChange.deltaPercent ? `${incomeChange.deltaPercent} vs. mês anterior` : null,
				value: formatBRL(now.summary.incomeCents),
				cents: now.summary.incomeCents,
			},
			...top.map((c) => ({
				label: c.name,
				caption: c.vsPrevious.deltaPercent ? `${c.vsPrevious.deltaPercent} vs. mês anterior` : c.share,
				value: c.text,
				cents: c.cents,
			})),
		];
		return {
			data: {
				month,
				previousMonth: previous,
				monthIsComplete: month < ctx.currentMonth,
				spent: { current: money(now.summary.spentCents), ...spentChange },
				income: { current: money(now.summary.incomeCents), ...incomeChange },
				incomeMinusSpent: money(now.summary.incomeCents - now.summary.spentCents),
				projection: now.projection
					? { projected: money(now.projection.projectedCents), lowConfidence: now.projection.lowConfidence }
					: null,
				topCategories: top,
				overBudget,
			},
			card: {
				type: "rows",
				tool: "get_month_report",
				title: `Relatório de ${monthLabel(month)}`,
				rows,
				total: null,
			},
		};
	},
});

export const listCatalog = defineTool({
	name: "list_catalog",
	label: "Consultando contas e categorias…",
	access: "read",
	description:
		"Contas, cartões e categorias do dono, com os ids. Chame antes de filtrar por categoria/conta/cartão ou de " +
		"propor um lançamento, para usar o id certo.",
	input: z.object({}),
	async run(_input, ctx) {
		const catalog = await ctx.catalog();
		return {
			data: {
				categories: catalog.categories.map((c) => ({ id: c.id, name: untrusted(c.name, 40) })),
				accounts: catalog.accounts.map((a) => ({
					id: a.id,
					name: untrusted(a.name, 40),
					kind: a.kind,
					isDefault: a.id === catalog.defaultAccountId,
				})),
				cards: catalog.cards.map((c) => ({
					id: c.id,
					name: untrusted(c.name, 40),
					last4: c.last4,
					closingDay: c.closingDay,
					dueDay: c.dueDay,
				})),
			},
		};
	},
});

export const listSavingsOpportunities = defineTool({
	name: "list_savings_opportunities",
	label: "Procurando onde cortar…",
	access: "read",
	description:
		"Onde o dono pode cortar custos, já calculado pelo engine: assinaturas parecidas ou que subiram de preço, " +
		"categoria acima da média dos últimos 3 meses, taxas/IOF/juros/anuidade pagos, compras pequenas repetidas, " +
		"parcelas pesando na renda, gasto projetado acima do orçamento e fatura a vencer sem saldo. `totalPerMonth` " +
		"é a soma do que dá para cortar por mês (sem contar duas vezes); cada item traz `savingsPerMonth` e um " +
		"`summary` pronto. Copie os valores e o texto prontos, NUNCA some itens. Use para 'onde posso cortar gastos', " +
		"'como economizar', 'tem assinatura repetida'. Não existe 'assinatura sem uso': o app não sabe se o dono " +
		"usa o serviço, então não afirme isso. Sugerir é só sugestão: quem cancela é o dono, direto no serviço.",
	input: z.object({}),
	async run(_input, ctx) {
		const reading = await ctx.reader.savingsOpportunities();
		const categoryName = (id: string) => reading.categoryNames[id] ?? "Sem categoria";
		const state = {
			remindingSubscriptionIds: new Set(reading.remindingSubscriptionIds),
			limitedCategoryIds: new Set(reading.limitedCategoryIds),
		};
		const items = reading.result.opportunities.map((o) => {
			const text = opportunityText(o, categoryName);
			return {
				key: o.key,
				type: o.type,
				title: text.title,
				summary: text.body,
				savingsPerMonth: money(o.monthlySavingsCents),
				confidence: o.confidence,
				countsInTotal: o.countsInTotal,
				evidenceTransactionIds: o.evidence.transactionIds,
				oneTapActions: opportunityActions(o, state),
			};
		});
		return {
			data: {
				count: items.length,
				totalPerMonth: money(reading.result.totalMonthlySavingsCents),
				autonomy: reading.autonomy,
				opportunities: items,
			},
			card: {
				type: "rows",
				tool: "list_savings_opportunities",
				title: "Onde cortar",
				rows: items.slice(0, 10).map((r) => ({
					label: r.title,
					caption: r.savingsPerMonth.cents > 0 ? "por mês" : "atenção",
					value: r.savingsPerMonth.cents > 0 ? r.savingsPerMonth.text : "—",
					cents: r.savingsPerMonth.cents,
				})),
				total: { label: "Dá para cortar por mês", value: formatBRL(reading.result.totalMonthlySavingsCents) },
			},
		};
	},
});

export const READ_TOOLS: readonly Tool[] = [
	getMonthSummary,
	searchTransactions,
	getBudgetStatus,
	getCardInvoice,
	listSubscriptions,
	getGoalsStatus,
	getIncomePlan,
	analyzeHistoryTool,
	getCategoryBreakdown,
	getMonthReport,
	listCatalog,
	listSavingsOpportunities,
];
