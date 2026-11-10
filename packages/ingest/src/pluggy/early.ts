import { addDays, type LocalDate } from "@orbita/core";
import type { TransactionRecord, TransactionStore, UpsertByExternalInput } from "@orbita/db";
import { normalizeMerchantName } from "@orbita/shared";
import { UNCERTAIN_TARGET_NOTE } from "../notification/notes.ts";
import { UNCONFIRMED_NOTE } from "../notification/reconcile.ts";
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
	transactions: Pick<
		TransactionStore,
		"listByTarget" | "adoptExternal" | "existsByExternal" | "update" | "softDelete"
	>,
	source: "pluggy",
	mapped: Upsert,
	/** Contas do mesmo banco do cartão desta transação (só para compra no cartão): ver `replaceUncertainNotification`. */
	sameBankAccountIds: readonly string[] = [],
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
		.map((t) => ({ t, gap: apart(t.date, input.date), score: nameScore(t, input) }))
		// Mais perto na data; no empate, o nome mais parecido com o do banco (duas notificações de R$ 10, uma na
		// padaria e outra na farmácia); só então o mais antigo.
		.sort(
			(a, b) =>
				a.gap - b.gap ||
				b.score - a.score ||
				a.t.createdAt.getTime() - b.t.createdAt.getTime() ||
				(a.t.id < b.t.id ? -1 : 1),
		);
	const best = candidates[0];
	if (best === undefined) {
		await replaceUncertainNotification(transactions, input, sameBankAccountIds);
		return { outcome: "none" };
	}
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
	if (!adopted) return { outcome: "none" };
	return { outcome: "adopted", transaction: await clearUnconfirmed(transactions, adopted) };
}

/**
 * Uma notificação que o banco "não confirmou" (ver `flagUnconfirmedNotifications`) e que agora o banco trouxe: a
 * dúvida acabou. Volta a confirmada e sem a nota, a menos que o dono já tenha mexido nela.
 */
export async function clearUnconfirmed(
	transactions: Pick<TransactionStore, "update">,
	t: TransactionRecord,
): Promise<TransactionRecord> {
	if (t.note !== UNCONFIRMED_NOTE || t.editedByOwner) return t;
	return transactions.update(t.id, { status: "confirmed", note: null });
}

/** 2 = mesmo nome, 1 = um contém o outro, 0 = sem relação (ou sem nome). */
function nameScore(t: TransactionRecord, input: UpsertByExternalInput): number {
	const a = normalizeMerchantName(t.merchantName ?? t.description);
	const b = normalizeMerchantName(input.merchantName ?? input.description);
	if (a === "" || b === "") return 0;
	if (a === b) return 2;
	return a.includes(b) || b.includes(a) ? 1 : 0;
}

/**
 * Compra no cartão que o banco traz agora e que uma notificação "Você pagou…" (alvo incerto: saldo ou cartão?) lançou na
 * CONTA do mesmo banco: o banco sabe onde foi, então o lançamento dele prevalece e a linha da notificação sai (exclusão
 * lógica), em vez de ficar duplicada. Só a que ninguém mexeu (o dono confirmando ou editando é decisão dele) e que
 * combina em tipo, valor e data (± a janela de sempre). Se a compra tivesse sido na conta, o banco a traria na conta e a
 * adoção normal a casaria: este caminho só roda quando nada casou no cartão.
 */
async function replaceUncertainNotification(
	transactions: Pick<TransactionStore, "listByTarget" | "softDelete">,
	input: UpsertByExternalInput,
	accountIds: readonly string[],
): Promise<void> {
	if (input.kind !== "expense" || !input.cardId || accountIds.length === 0) return;
	const found: TransactionRecord[] = [];
	for (const accountId of accountIds) {
		const rows = await transactions.listByTarget(
			{ accountId },
			{ from: addDays(input.date, -EARLY_WINDOW_DAYS), to: addDays(input.date, EARLY_WINDOW_DAYS) },
		);
		found.push(
			...rows.filter(
				(t) =>
					t.source === "notification" &&
					t.note === UNCERTAIN_TARGET_NOTE &&
					!t.editedByOwner &&
					t.kind === "expense" &&
					t.amountCents === input.amountCents &&
					t.installmentNumber === null,
			),
		);
	}
	const best = found
		.map((t) => ({ t, gap: apart(t.date, input.date), score: nameScore(t, input) }))
		.sort(
			(a, b) => a.gap - b.gap || b.score - a.score || a.t.createdAt.getTime() - b.t.createdAt.getTime(),
		)[0];
	if (best) await transactions.softDelete(best.t.id);
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
