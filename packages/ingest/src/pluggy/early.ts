import { addDays, type LocalDate } from "@orbita/core";
import type { TransactionRecord, TransactionStore, UpsertByExternalInput } from "@orbita/db";
import type { MappedTransaction } from "./mapping.ts";

/*
 * Lançamentos antecipados: o dono lança o gasto (à mão, pelo chat, importando extrato) dias antes de o Open Finance
 * trazê-lo. Quando o Pluggy traz a mesma compra, ela deve ADOTAR o lançamento do dono em vez de duplicar. Ver
 * docs/pluggy.md ("Lançamentos antecipados"). Lógica pura: só fala com o `TransactionStore` recebido.
 */

/** Dias para cada lado da data do banco (a data da compra, nunca a da fatura). */
export const EARLY_WINDOW_DAYS = 3;
/** "Marcar como paga" lança o pagamento no dia do toque; o débito real pode cair alguns dias depois. */
export const PAYMENT_WINDOW_DAYS = 5;
/** Parcela: o dono lança com a data da parcela e o banco pode usar a da compra; a busca é maior e a fatura também vale. */
const INSTALLMENT_REACH_DAYS = 45;

export const POSSIBLE_DUPLICATE_NOTE =
	"Possível duplicata: já existe um lançamento seu parecido (mesmo valor e dias próximos). Confira e apague um dos dois.";

type Upsert = Extract<MappedTransaction, { action: "upsert" }>;

export type EarlyOutcome =
	| { outcome: "none" }
	/** O lançamento do dono passou a apontar para o Pluggy. */
	| { outcome: "adopted"; transaction: TransactionRecord }
	/** Mais de um lançamento do dono serve igualmente: nada foi adotado. */
	| { outcome: "ambiguous"; candidates: number };

const apart = (a: LocalDate, b: LocalDate) =>
	Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

/**
 * Procura, para uma transação do Pluggy ainda não gravada, o lançamento do dono que ela repete: que NÃO veio do Pluggy
 * (um que veio já foi casado), vivo, na mesma conta ou no mesmo cartão, do mesmo tipo (despesa ou receita), com o mesmo
 * valor em centavos, com data a até `EARLY_WINDOW_DAYS` dias da data do banco e, se for parcela, a mesma parcela (n/N).
 * Um só mais próximo na data: adota (`adoptExternal`). Empate no mais próximo: `ambiguous`. Nenhum: `none`.
 */
export async function adoptEarlyEntry(
	transactions: Pick<TransactionStore, "listByTarget" | "adoptExternal" | "existsByExternal">,
	source: "pluggy",
	mapped: Upsert,
): Promise<EarlyOutcome> {
	const { input } = mapped;
	// Parcela avulsa (sem data da compra, o Pluggy não dá como agrupar) traz só a nota "Parcela n/N".
	const installment = mapped.installment ?? parcelOfNote(input.note);
	const isPayment = input.kind === "card_payment";
	if (input.kind !== "expense" && input.kind !== "income" && !isPayment) return { outcome: "none" };
	const target = input.cardId
		? { cardId: input.cardId }
		: input.accountId
			? { accountId: input.accountId }
			: null;
	if (target === null) return { outcome: "none" };
	if (await transactions.existsByExternal(source, mapped.externalId)) return { outcome: "none" };

	const window = isPayment ? PAYMENT_WINDOW_DAYS : EARLY_WINDOW_DAYS;
	const reach = installment ? INSTALLMENT_REACH_DAYS : window;
	const rows = await transactions.listByTarget(target, {
		from: addDays(input.date, -reach),
		to: addDays(input.date, reach),
	});
	const candidates = rows
		.filter((t) => matches(t, input, installment, source, window))
		.map((t) => ({ t, gap: apart(t.date, input.date) }))
		.sort(
			(a, b) =>
				a.gap - b.gap || a.t.createdAt.getTime() - b.t.createdAt.getTime() || (a.t.id < b.t.id ? -1 : 1),
		);
	const best = candidates[0];
	if (best === undefined) return { outcome: "none" };
	const tied = candidates.filter((c) => c.gap === best.gap);
	// Lançamentos criados por notificação, iguais em tudo, são intercambiáveis (duas compras idênticas no mesmo dia):
	// adota o mais antigo; o seguinte fica para a próxima transação do banco. Empate com algo digitado pelo dono é
	// dúvida de verdade.
	if (tied.length > 1 && !tied.every((c) => c.t.source === "notification")) {
		return { outcome: "ambiguous", candidates: tied.length };
	}

	const adopted = await transactions.adoptExternal(best.t.id, source, mapped.externalId, {
		date: input.date,
		// Parcela: os meses seguem o cronograma do dono; o resto usa o que o banco diz.
		...(installment || isPayment
			? {}
			: { budgetMonth: input.budgetMonth ?? null, invoiceMonth: input.invoiceMonth ?? null }),
		categoryId: input.categoryId ?? null,
		sourceCategory: input.sourceCategory ?? null,
		merchantName: input.merchantName ?? null,
	});
	// Perdeu a corrida (apagado ou adotado por outra rodada agora): segue como sem candidato, o upsert grava normal.
	return adopted ? { outcome: "adopted", transaction: adopted } : { outcome: "none" };
}

const parcelOfNote = (note: string | null | undefined) => {
	const m = /^Parcela (\d{1,3})\/(\d{1,3})$/.exec(note ?? "");
	return m ? { number: Number(m[1]), count: Number(m[2]) } : undefined;
};

function matches(
	t: TransactionRecord,
	input: UpsertByExternalInput,
	installment: { number: number; count: number } | undefined,
	source: string,
	window: number,
): boolean {
	if (t.source === source) return false;
	if (t.kind !== input.kind || t.amountCents !== input.amountCents) return false;
	// Pagamento de fatura: a conta de onde saiu o dinheiro tem de ser a mesma, quando as duas lados a informam.
	if (t.kind === "card_payment" && t.accountId && input.accountId && t.accountId !== input.accountId)
		return false;
	if (installment) {
		if (t.installmentNumber !== installment.number || t.installmentCount !== installment.count) return false;
		return (
			apart(t.date, input.date) <= window ||
			(t.invoiceMonth !== null && t.invoiceMonth === (input.invoiceMonth ?? null))
		);
	}
	return t.installmentNumber === null && apart(t.date, input.date) <= window;
}
