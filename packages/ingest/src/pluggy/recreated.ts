import { addDays, daysBetween, type LocalDate, toLocalDate } from "@orbita/core";
import type { TransactionRecord, TransactionStore, UpsertByExternalInput } from "@orbita/db";
import { plain } from "./classify.ts";
import { type MappedTransaction, PLUGGY_SOURCE, touchedByOwner } from "./mapping.ts";
import type { RelinkOutcome } from "./relink.ts";

/*
 * Lançamento APAGADO e RECRIADO pelo Pluggy com id novo, sem duplicar no Órbita.
 *
 * O que a doc diz (docs.pluggy.ai/docs/transactions, "Transaction Id can change — how to reconcile"):
 * - a Pluggy mantém o mesmo id entre sincronizações (inclusive PENDING → POSTED); só quando data, descrição ou valor
 *   mudam demais ela apaga e recria com id novo, e o webhook `transactions/deleted` NÃO aponta o substituto;
 * - "To reconcile across a delete/recreate, anchor on a provider-side identifier: providerId (Open Finance) or
 *   providerCode (an institution code such as an NSU; format varies per institution)";
 * - sem identificador estável, "match on attributes (date + amount + description)".
 * Em docs.pluggy.ai/docs/credit-card-installments: o banco pode parar de devolver uma transação por 1 a 3 dias e ela
 * volta com id novo (fim de semana, instabilidade).
 *
 * Ordem de confiança (cada degrau só vale se o anterior não achou):
 * 1. `providerId` igual (Open Finance): é o id do banco, vale sozinho;
 * 2. `providerCode` igual COM o mesmo valor e a data a até 3 dias (o código varia por instituição, não basta);
 * 3. SEM âncora que sirva (INFERÊNCIA do Órbita, a doc só manda casar por atributos): mesmo tipo, valor, descrição
 *    normalizada, parcela e data a até 3 dias.
 * Em todos, o candidato é um lançamento Pluggy VIVO da mesma conta/cartão cujo id antigo NÃO veio na resposta atual (se
 * o banco ainda devolve o id antigo, ele não foi recriado) e que está dentro da janela buscada (fora dela, o id antigo
 * some só porque a janela não o alcança). Mais de um candidato, ou mais candidatos que lançamentos novos iguais no
 * lote, é ambíguo: nada é religado e o chamador grava o novo para revisão.
 */

/** Folga de data para o casamento por atributos e por `providerCode` (mesma folga dos lançamentos antecipados). */
export const RECREATED_WINDOW_DAYS = 3;

type Upsert =
	| Extract<MappedTransaction, { action: "upsert" }>
	| Extract<MappedTransaction, { action: "refund" }>;

export type RecreatedStore = Pick<
	TransactionStore,
	"listByProvider" | "listByTarget" | "rekeyExternal" | "existsByExternal"
>;

const targetOf = (input: UpsertByExternalInput) =>
	input.cardId ? { cardId: input.cardId } : input.accountId ? { accountId: input.accountId } : null;

const parcel = (installment: { number: number; count: number } | undefined, note?: string | null) => {
	const fromNote = /^Parcela (\d{1,3})\/(\d{1,3})$/.exec(note ?? "");
	const n = installment?.number ?? (fromNote ? Number(fromNote[1]) : null);
	const c = installment?.count ?? (fromNote ? Number(fromNote[2]) : null);
	return `${n ?? ""}/${c ?? ""}`;
};

/** Identidade por atributos de um lançamento NOVO (como chegou do banco) para contar gêmeos no lote. */
export function attributeKey(input: UpsertByExternalInput, installment?: { number: number; count: number }) {
	return [
		input.kind,
		input.accountId ?? "",
		input.cardId ?? "",
		input.amountCents,
		plain(input.description),
		parcel(installment, input.note),
	].join("|");
}

const keyOfRecord = (t: TransactionRecord) =>
	attributeKey(
		t,
		t.installmentNumber !== null
			? { number: t.installmentNumber, count: t.installmentCount ?? 0 }
			: undefined,
	);

const apart = (a: LocalDate, b: LocalDate) => Math.abs(daysBetween(a, b));

/** Um lançamento novo do lote ainda não resolvido (para contar quantos iguais disputam os candidatos). */
export interface BatchPeer {
	externalId: string;
	input: UpsertByExternalInput;
	installment?: { number: number; count: number } | undefined;
}

export interface RecreatedContext {
	/** Ids do Pluggy desta resposta (conta/cartão): um candidato cujo id ainda vem aqui NÃO foi recriado. */
	currentIds: ReadonlySet<string>;
	/** Primeiro dia que a busca alcançou: o candidato mais antigo que isso sumiu da resposta só por falta de janela. */
	windowFrom: LocalDate;
	/**
	 * Lançamentos NOVOS do lote ainda sem resolução (inclui o próprio). Função porque só o passo 3 precisa, e só quando há
	 * candidato: evita uma consulta por lançamento.
	 */
	peers: () => Promise<readonly BatchPeer[]>;
}

/**
 * Para um lançamento do Pluggy ainda não gravado, acha o que o MESMO lançamento já era no Órbita com o id antigo e troca
 * só o id externo (`rekeyExternal`): o que o dono editou fica como está, nada é recriado. Devolve o mesmo formato de
 * `rekeyRelinked` para o `sync.ts` tratar os dois igual.
 */
export async function reconcileRecreated(
	transactions: RecreatedStore,
	mapped: Upsert,
	context: RecreatedContext,
	/** `anchors`: só os degraus 1 e 2 (ids do banco); `attributes`: só o 3. O chamador intercala o relink do item antigo. */
	phase: "anchors" | "attributes",
): Promise<RelinkOutcome> {
	const { input } = mapped;
	const target = targetOf(input);
	if (target === null) return { outcome: "none" };
	if (await transactions.existsByExternal(PLUGGY_SOURCE, mapped.externalId)) return { outcome: "none" };
	const installment = "installment" in mapped ? mapped.installment : undefined;

	const gone = (t: TransactionRecord) =>
		t.source === PLUGGY_SOURCE &&
		t.externalId !== null &&
		t.externalId !== mapped.externalId &&
		!context.currentIds.has(t.externalId) &&
		t.date >= context.windowFrom;
	// Dois lançamentos do banco com âncoras diferentes nunca são o mesmo.
	const sameAnchors = (t: TransactionRecord) =>
		!(input.providerId && t.providerId && t.providerId !== input.providerId);

	const rekey = async (t: TransactionRecord): Promise<RelinkOutcome> => {
		const moved = await transactions.rekeyExternal(t.id, PLUGGY_SOURCE, mapped.externalId);
		return moved ? { outcome: "rekeyed", transaction: moved } : { outcome: "none" };
	};

	// 1) providerId: o id do banco para o lançamento. Vale sozinho (a doc: "anchor on a provider-side identifier").
	if (phase === "anchors" && input.providerId) {
		const rows = (await transactions.listByProvider(PLUGGY_SOURCE, target, { providerId: input.providerId }))
			.filter((t) => t.providerId === input.providerId)
			.filter(gone);
		if (rows.length === 1 && rows[0]) return rekey(rows[0]);
		if (rows.length > 1) return { outcome: "ambiguous", candidates: rows.length };
	}

	// 2) providerCode + valor + data (o código varia por instituição: sozinho não basta).
	if (phase === "anchors" && input.providerCode) {
		const rows = (
			await transactions.listByProvider(PLUGGY_SOURCE, target, { providerCode: input.providerCode })
		)
			.filter(
				(t) =>
					t.providerCode === input.providerCode &&
					t.amountCents === input.amountCents &&
					t.kind === input.kind &&
					apart(t.date, input.date) <= RECREATED_WINDOW_DAYS,
			)
			.filter(gone)
			.filter(sameAnchors);
		if (rows.length === 1 && rows[0]) return rekey(rows[0]);
		if (rows.length > 1) return { outcome: "ambiguous", candidates: rows.length };
	}

	if (phase === "anchors") return { outcome: "none" };
	// 3) Atributos (valor, tipo, descrição, parcela, data ±3 dias) quando o banco não deu âncora que casou.
	const key = attributeKey(input, installment);
	const rows = (
		await transactions.listByTarget(target, {
			from: addDays(input.date, -RECREATED_WINDOW_DAYS),
			to: addDays(input.date, RECREATED_WINDOW_DAYS),
		})
	)
		.filter((t) => gone(t) && sameAnchors(t) && keyOfRecord(t) === key)
		.sort(
			(a, b) =>
				apart(a.date, input.date) - apart(b.date, input.date) ||
				a.createdAt.getTime() - b.createdAt.getTime() ||
				(a.id < b.id ? -1 : 1),
		);
	if (rows.length === 0) return { outcome: "none" };
	// Quantos lançamentos novos iguais disputam estes candidatos (dois cafés iguais no mesmo dia casam um a um).
	const rivals = (await context.peers()).filter(
		(p) =>
			attributeKey(p.input, p.installment) === key &&
			apart(p.input.date, input.date) <= RECREATED_WINDOW_DAYS,
	).length;
	if (rows.length !== Math.max(rivals, 1)) return { outcome: "ambiguous", candidates: rows.length };
	const best = rows[0];
	return best ? rekey(best) : { outcome: "none" };
}

// ---------------------------------------------------------------- sumiu e não voltou

/**
 * Dias sem o banco devolver um lançamento PENDING (compra da fatura aberta) até concluir que ele não existe mais. A
 * doc diz que o banco pode parar de devolver "for 1 to 3 days" e depois devolver com id novo
 * (docs.pluggy.ai/docs/credit-card-installments); 7 dias é o dobro do pior caso documentado, com folga para um fim de
 * semana prolongado (INFERÊNCIA do Órbita: a doc não dá um prazo).
 */
export const PENDING_VANISH_DAYS = 7;
/** Idem para o que já efetivou (POSTED): sumir de vez é mais raro e mais grave, então espera o mesmo prazo. */
export const POSTED_VANISH_DAYS = 7;
/**
 * Proteção contra resposta incompleta do banco (instabilidade): se mais que isto dos lançamentos da janela somem de
 * uma vez, o Órbita não apaga nada (INFERÊNCIA: a doc só descreve sumiço pontual).
 */
export const VANISH_MASS_RATIO = 0.3;
export const VANISH_MASS_MIN = 5;

export const REMOVED_BY_BANK_NOTE =
	"O banco deixou de informar este lançamento. Confira se ele ainda existe e apague se não.";

export interface VanishInput {
	target: { accountId: string } | { cardId: string };
	/** Todos os ids do Pluggy que a resposta desta conta/cartão trouxe (qualquer tipo de lançamento). */
	seenIds: ReadonlySet<string>;
	/** Janela que a busca cobriu (data do Pluggy). */
	from: LocalDate;
	today: LocalDate;
	now: Date;
}

export interface VanishResult {
	/** Apagados (marcados "removido pelo banco"). */
	removed: number;
	/** Editados pelo dono: não apagados, só marcados para revisão. */
	flagged: number;
	/** Sem registro de quando foram vistos pela última vez: o relógio começou agora. */
	started: number;
	/** Passou da proteção contra resposta incompleta: nada foi apagado. */
	skippedMass: boolean;
}

/**
 * Lançamentos Pluggy vivos da janela que a resposta atual NÃO trouxe. Cada rodada que os vê marca `lastSeenAt`
 * (`markSeen`); quem passa do prazo sem voltar é removido (`removeByBank`), exceto o que o dono editou, que só vai para
 * "Para revisar" (`flagMissingByBank`). `removedByBankAt` já marcado = já tratado (não repete). Parcelas de cartão
 * ficam de fora: a data delas na Pluggy não é a do Órbita (data da compra), então a janela não as delimita.
 * Idempotente: se o banco devolver o lançamento depois, `markSeen`/`reviveRemovedByBank` o trazem de volta.
 */
export async function reviewVanished(
	transactions: Pick<TransactionStore, "listByTarget" | "removeByBank" | "flagMissingByBank" | "markSeen">,
	input: VanishInput,
): Promise<VanishResult> {
	const result: VanishResult = { removed: 0, flagged: 0, started: 0, skippedMass: false };
	if (input.seenIds.size === 0) return result;
	// A data do Pluggy ≥ a do Órbita (o Órbita usa a data da compra), então com 1 dia de folga a linha está na janela.
	const rows = (
		await transactions.listByTarget(input.target, { from: addDays(input.from, 1), to: input.today })
	).filter((t) => t.source === PLUGGY_SOURCE && t.externalId !== null && t.installmentGroupId === null);
	const missing = rows.filter((t) => t.externalId !== null && !input.seenIds.has(t.externalId));
	if (missing.length === 0) return result;
	if (missing.length > Math.max(VANISH_MASS_MIN, Math.floor(rows.length * VANISH_MASS_RATIO))) {
		result.skippedMass = true;
		return result;
	}
	const startClock: string[] = [];
	for (const t of missing) {
		if (t.removedByBankAt !== null) continue;
		if (t.lastSeenAt === null) {
			startClock.push(t.externalId as string);
			continue;
		}
		const absent = daysBetween(toLocalDate(t.lastSeenAt), toLocalDate(input.now));
		if (absent < (t.bankPending ? PENDING_VANISH_DAYS : POSTED_VANISH_DAYS)) continue;
		if (touchedByOwner(t)) {
			const flagged = await transactions.flagMissingByBank(t.id, input.now, {
				status: "pending",
				note: t.note ?? REMOVED_BY_BANK_NOTE,
			});
			if (flagged) result.flagged += 1;
		} else if (await transactions.removeByBank(t.id, input.now)) {
			result.removed += 1;
		}
	}
	if (startClock.length > 0)
		result.started = await transactions.markSeen(PLUGGY_SOURCE, startClock, input.now);
	return result;
}
