import { addMonths, type LocalDate, monthOf } from "@orbita/core";
import { DataError, type Stores, type TransactionCursor } from "@orbita/db";
import { SETUP_LOOKBACK_MONTHS, type SetupAnalysis, type SetupApplyInput } from "@orbita/shared";
import { analyzeHistory, type SetupTransaction } from "./setup-analysis.ts";

/*
 * Lê as stores e roda a análise do histórico. A API (tela, chat) e as ferramentas da IA usam esta mesma função, então
 * o número que a IA cita é o que o card mostra e o que o servidor confere ao confirmar.
 */

const PAGE = 500;
/** Teto de segurança: 20 páginas de 500 lançamentos em 12 meses é muito mais que um dono de verdade. */
const MAX_PAGES = 20;

export async function loadSetupAnalysis(stores: Stores, today: LocalDate): Promise<SetupAnalysis> {
	const startMonth = addMonths(monthOf(today), -(SETUP_LOOKBACK_MONTHS - 1));
	const from: LocalDate = `${startMonth}-01`;

	const transactions: SetupTransaction[] = [];
	let before: TransactionCursor | undefined;
	for (let page = 0; page < MAX_PAGES; page += 1) {
		const rows = await stores.transactions.listRecent({
			limit: PAGE,
			...(before ? { before } : {}),
			filter: { from, to: today, kinds: ["expense", "income"] },
		});
		for (const t of rows) {
			if (t.kind !== "expense" && t.kind !== "income") continue;
			transactions.push({
				id: t.id,
				kind: t.kind,
				date: t.date,
				amountCents: t.amountCents,
				description: t.description,
				merchantName: t.merchantName,
				categoryId: t.categoryId,
				accountId: t.accountId,
				cardId: t.cardId,
				installment: t.installmentGroupId !== null,
			});
		}
		const last = rows.at(-1);
		if (rows.length < PAGE || !last) break;
		before = { date: last.date, id: last.id };
	}

	const months = Array.from({ length: SETUP_LOOKBACK_MONTHS }, (_, i) => addMonths(monthOf(today), -i));
	const [recurrences, income, categories, rules, postings] = await Promise.all([
		stores.recurrences.list(),
		stores.incomeSources.list(),
		stores.categories.list(),
		stores.categoryRules.list(),
		Promise.all(months.map((m) => stores.recurrences.listPostings(m))),
	]);
	return analyzeHistory({
		transactions,
		today,
		registeredNames: recurrences.filter((r) => r.kind === "expense").map((r) => r.name),
		hasIncome: income.length > 0,
		categories: categories.filter((c) => c.archivedAt === null).map((c) => ({ id: c.id, slug: c.slug })),
		rules: rules.map((r) => ({ pattern: r.pattern, categoryId: r.categoryId })),
		recurringTransactionIds: new Set(postings.flat().map((p) => p.transactionId)),
	});
}

export const STALE_SETUP_MESSAGE =
	"O seu histórico mudou desde que a Órbita montou esta proposta. Peça a análise de novo para ver os valores de agora.";

/**
 * Confere cada número da proposta contra uma análise (a de agora): a assinatura precisa existir e ainda não estar
 * cadastrada, com o mesmo valor e o mesmo dia; a regra, com o mesmo padrão; a renda, com o mesmo valor e dia. Nunca
 * se confia em número vindo do modelo nem guardado há tempo. Devolve o mesmo pedido com a data de início da análise
 * de agora (o mês seguinte à última cobrança que existe hoje).
 */
export function verifyAgainstAnalysis(analysis: SetupAnalysis, input: SetupApplyInput): SetupApplyInput {
	const recurring = new Map(analysis.recurring.map((r) => [r.key, r]));
	const candidates = new Map(analysis.categoryCandidates.map((c) => [c.key, c]));
	const stale = () => new DataError("invalid", STALE_SETUP_MESSAGE);

	const subscriptions = input.subscriptions.map((s) => {
		const found = recurring.get(s.key);
		if (!found || found.registered) throw stale();
		if (found.amountCents !== s.amountCents || found.dayOfMonth !== s.dayOfMonth) throw stale();
		return { ...s, startDate: found.startDate };
	});
	for (const r of input.categoryRules) {
		const found = candidates.get(r.key);
		if (!found || found.pattern !== r.pattern) throw stale();
	}
	if (input.income) {
		const found = analysis.income;
		if (
			!found ||
			found.key !== input.income.key ||
			found.amountCents !== input.income.amountCents ||
			found.payday !== input.income.payday
		) {
			throw stale();
		}
	}
	return { ...input, subscriptions };
}
