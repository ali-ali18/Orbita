import { createHash } from "node:crypto";
import { addDays, invoiceFor, type LocalDate, toLocalDate } from "@orbita/core";
import {
	type AccountRecord,
	type CardRecord,
	DataError,
	type PreferencesRecord,
	type Stores,
	type TransactionRecord,
	toCardConfig,
	type UpsertByExternalInput,
} from "@orbita/db";
import {
	isSensitiveNotification,
	NOTIFICATION_APP_LABELS,
	NOTIFICATION_APPS_VERIFIED,
	NOTIFICATION_REPOST_WINDOW_MINUTES,
	type NotificationApp,
	type NotificationInboxReason,
	type NotificationItem,
	type NotificationResult,
	normalizeMerchantName,
	notificationAppOfPackage,
	pickCategoryRule,
} from "@orbita/shared";
import { bankIspb, findKnownBank } from "../pluggy/bank-name.ts";
import { EARLY_WINDOW_DAYS, nameSimilarity } from "../pluggy/early.ts";
import { touchedByOwner } from "../pluggy/mapping.ts";
import { CANCELLED_NOTE, differentFinalNote, UNCERTAIN_TARGET_NOTE, UNVERIFIED_BANK_NOTE } from "./notes.ts";
import { type CancelledPurchase, type ParsedNotification, parseNotification } from "./parse.ts";
import { sameBankCardIds } from "./same-bank.ts";

/*
 * Da notificação lida no aparelho ao lançamento. Mesmo caminho para a notificação que acabou de chegar e para a que
 * esperava na lista "Não entendi" (`retryNotificationInbox`). O texto é dado de terceiro: serve só para o parser ler;
 * quem decide o que acontece com ele são estas regras.
 *
 * Duplicidade: o lançamento nasce com `source: "notification"` e `externalId` = hash de (pacote, título, texto, minuto),
 * então a mesma notificação reenviada (fila local que repete, Android que posta de novo) nunca cria outro. Quando o
 * Open Finance traz a mesma compra, `adoptEarlyEntry` (pluggy/early.ts) adota este lançamento em vez de duplicar.
 */

export const NOTIFICATION_SOURCE = "notification" as const;

export { UNCERTAIN_TARGET_NOTE, UNVERIFIED_BANK_NOTE };

export interface NotificationDeps {
	stores: Pick<
		Stores,
		| "accounts"
		| "cards"
		| "transactions"
		| "categoryRules"
		| "preferences"
		| "notificationInbox"
		| "notificationCardLinks"
	>;
	now: () => Date;
}

/** Quantos minutos para cada lado a mesma notificação repostada (o app do banco a atualiza) ainda conta como a mesma. */
export const REPOST_WINDOW_MINUTES = NOTIFICATION_REPOST_WINDOW_MINUTES;
/** Prazo da lista "Não entendi": passado isto, a notificação sai (o Open Finance já trouxe a compra há muito). */
export const INBOX_MAX_AGE_DAYS = 30;

const stableOf = (
	item: Pick<NotificationItem, "package" | "title" | "text"> & { sbnKey?: string | undefined },
) =>
	createHash("sha256")
		.update(`${item.package}\n${item.title}\n${item.text}\n${item.sbnKey ?? ""}`)
		.digest("hex")
		.slice(0, 24);

/**
 * Identificador da notificação: `n:<parte estável>:<minuto>`. A parte estável é o hash de pacote + título + texto +
 * chave da notificação no Android; o minuto é o em que o Android a registrou. Repetir o envio dá a mesma chave; duas
 * compras iguais (chaves do Android diferentes) dão chaves diferentes.
 */
export function notificationKey(
	item: Pick<NotificationItem, "package" | "title" | "text" | "postedAt"> & { sbnKey?: string | undefined },
): string {
	return `n:${stableOf(item)}:${Math.floor(item.postedAt / 60_000)}`;
}

/** A mesma notificação repostada pouco depois (minuto vizinho) já virou lançamento? */
async function repostedRecently(
	transactions: NotificationDeps["stores"]["transactions"],
	key: string,
): Promise<boolean> {
	const m = /^n:([0-9a-f]+):(\d+)$/.exec(key);
	if (!m) return false;
	const minute = Number(m[2]);
	for (let d = -REPOST_WINDOW_MINUTES; d <= REPOST_WINDOW_MINUTES; d++) {
		if (d === 0) continue;
		if (await transactions.findByExternal(NOTIFICATION_SOURCE, `n:${m[1]}:${minute + d}`)) return true;
	}
	return false;
}

interface Resolved {
	app: NotificationApp;
	title: string;
	text: string;
	postedAt: Date;
	key: string;
}

const isActive = (x: { archivedAt: Date | null }) => x.archivedAt === null;

/** O cartão/conta é do banco do app? Pelo ISPB quando há; senão pelo banco citado no nome. */
function bankMatcher(app: NotificationApp) {
	const label = NOTIFICATION_APP_LABELS[app];
	const ispb = bankIspb(label);
	const name = findKnownBank(label);
	return (item: { bankCode: string | null; name: string }) =>
		item.bankCode !== null
			? ispb !== null && item.bankCode === ispb
			: name !== null && findKnownBank(item.name) === name;
}

/**
 * Cartão do banco pelo final (os 4 últimos dígitos que a notificação cita). Sem final, só se o banco tem um cartão
 * só. Mais de um candidato, ou nenhum: `null` (nunca se chuta um cartão).
 */
export function pickCard(
	app: NotificationApp,
	cards: readonly CardRecord[],
	last4: string | null,
): CardRecord | null {
	const sameBank = cards.filter(isActive).filter(bankMatcher(app));
	const pool = last4 === null ? sameBank : sameBank.filter((c) => c.last4 === last4);
	return pool.length === 1 ? (pool[0] as CardRecord) : null;
}

/**
 * Cartão de uma notificação, na ordem: (1) o final que o dono (ou o app) já ligou a um cartão; (2) o cartão do banco
 * com este final; (3) só com `learn`, e só se o final não bate com nenhum cartão do banco e o banco tem UM cartão
 * ativo: é ele (compra online usa o final do cartão virtual, que não é o do físico que o banco informa). Esse caso
 * liga o final ao cartão para as próximas e devolve a nota de que o final é diferente. Mais de um cartão: `null`.
 */
async function resolveCard(
	stores: Pick<NotificationDeps["stores"], "cards" | "notificationCardLinks">,
	app: NotificationApp,
	last4: string | null,
	learn: boolean,
): Promise<{ card: CardRecord; note?: string } | null> {
	const all = await stores.cards.list();
	if (last4 !== null) {
		const link = await stores.notificationCardLinks.get(app, last4);
		const linked = link ? all.find((c) => c.id === link.cardId && isActive(c)) : undefined;
		if (linked) return { card: linked };
	}
	const exact = pickCard(app, all, last4);
	if (exact) return { card: exact };
	if (!learn || last4 === null) return null;
	const sameBank = all.filter(isActive).filter(bankMatcher(app));
	// O final bate com mais de um cartão do banco (ambíguo): nunca se adivinha.
	if (sameBank.length !== 1 || sameBank.some((c) => c.last4 === last4)) return null;
	const card = sameBank[0] as CardRecord;
	await stores.notificationCardLinks.set(app, last4, card.id);
	return { card, note: differentFinalNote(last4) };
}

/** Conta corrente (ou carteira) do banco. Duas ou mais: só se uma delas é a única "corrente". */
export function pickAccount(app: NotificationApp, accounts: readonly AccountRecord[]): AccountRecord | null {
	const pool = accounts
		.filter(isActive)
		.filter((a) => a.kind === "checking" || a.kind === "wallet")
		.filter(bankMatcher(app));
	if (pool.length === 1) return pool[0] as AccountRecord;
	const checking = pool.filter((a) => a.kind === "checking");
	return checking.length === 1 ? (checking[0] as AccountRecord) : null;
}

function describe(parsed: ParsedNotification): string {
	const who = parsed.merchant;
	switch (parsed.kind) {
		case "pix_sent":
			return who ? `Pix para ${who}` : "Pix enviado";
		case "pix_received":
			return who ? `Pix de ${who}` : "Pix recebido";
		case "invoice_payment":
			return "Pagamento de fatura";
		case "credit_purchase":
			return who ?? "Compra no cartão";
		case "debit_purchase":
			return who ?? "Compra no débito";
	}
}

type Built = { input: UpsertByExternalInput } | { missing: true };

/** Monta o lançamento. `missing`: não achei o cartão ou a conta (vai para a lista, sem chute). */
async function build(
	deps: NotificationDeps,
	prefs: PreferencesRecord,
	n: Resolved,
	parsed: ParsedNotification,
	date: LocalDate,
): Promise<Built> {
	const { accounts, categoryRules } = deps.stores;
	const description = describe(parsed);
	// Vai para "Para revisar" quando o dono pediu, quando o banco não tem formato conferido ou quando o texto não diz de
	// onde saiu o dinheiro: nesses casos nunca entra confirmado sozinho.
	const unverified = !NOTIFICATION_APPS_VERIFIED.includes(n.app);
	const review = prefs.notificationAskFirst || unverified || parsed.uncertainTarget === true;
	const reviewNote = parsed.uncertainTarget
		? UNCERTAIN_TARGET_NOTE
		: unverified
			? UNVERIFIED_BANK_NOTE
			: null;
	const base = {
		amountCents: parsed.amountCents,
		date,
		description,
		// "Para revisar" (o dono confirma) ou direto, contando no gasto, só "aguardando o banco".
		status: review ? ("pending" as const) : ("confirmed" as const),
		note: reviewNote,
		bankPending: true,
		merchantName: parsed.merchant,
	};
	switch (parsed.kind) {
		case "credit_purchase": {
			const found = await resolveCard(deps.stores, n.app, parsed.last4, true);
			if (!found) return { missing: true };
			const { card } = found;
			const rule = pickCategoryRule(await categoryRules.list(), description);
			return {
				input: {
					...base,
					// Final diferente do cartão (o único do banco): entra em Para revisar com a nota.
					...(found.note
						? { status: "pending" as const, note: [found.note, reviewNote].filter(Boolean).join(" ") }
						: {}),
					kind: "expense",
					cardId: card.id,
					invoiceMonth: invoiceFor(date, toCardConfig(card)).month,
					categoryId: rule?.categoryId ?? null,
				},
			};
		}
		case "debit_purchase":
		case "pix_sent": {
			const account = pickAccount(n.app, await accounts.list());
			if (!account) return { missing: true };
			const rule = pickCategoryRule(await categoryRules.list(), description);
			return {
				input: { ...base, kind: "expense", accountId: account.id, categoryId: rule?.categoryId ?? null },
			};
		}
		case "pix_received": {
			const account = pickAccount(n.app, await accounts.list());
			if (!account) return { missing: true };
			return { input: { ...base, kind: "income", accountId: account.id } };
		}
		case "invoice_payment": {
			const account = pickAccount(n.app, await accounts.list());
			const card = (await resolveCard(deps.stores, n.app, parsed.last4, false))?.card;
			if (!account || !card) return { missing: true };
			return { input: { ...base, kind: "card_payment", accountId: account.id, cardId: card.id } };
		}
	}
}

/**
 * O banco (Open Finance) já trouxe esta compra? Acontece quando a notificação chega tarde (celular sem rede por dias) ou
 * é reenviada depois de o Pluggy adotar o lançamento dela (a adoção troca a origem, e com ela a chave de idempotência).
 * Mesmo alvo, tipo e valor, até `EARLY_WINDOW_DAYS` dias. Falha para o lado seguro: o banco é a fonte da verdade e traz
 * tudo; na pior das hipóteses (duas compras iguais no mesmo dia) a segunda só aparece quando o banco a trouxer, em vez
 * de ficar duplicada para sempre.
 */
async function alreadyInBank(
	transactions: NotificationDeps["stores"]["transactions"],
	input: UpsertByExternalInput,
	/** Alvo incerto (saldo ou cartão?): também procura nos cartões do mesmo banco (mesmo valor, tipo e janela). */
	otherCardIds: readonly string[] = [],
): Promise<boolean> {
	const target = input.cardId
		? { cardId: input.cardId }
		: input.accountId
			? { accountId: input.accountId }
			: null;
	if (target === null) return false;
	const window = {
		from: addDays(input.date, -EARLY_WINDOW_DAYS),
		to: addDays(input.date, EARLY_WINDOW_DAYS),
	};
	for (const cardId of otherCardIds) {
		const onCard = await transactions.listByTarget({ cardId }, window);
		if (
			onCard.some(
				(t) =>
					t.source === "pluggy" &&
					t.kind === input.kind &&
					t.amountCents === input.amountCents &&
					t.installmentNumber === null &&
					// Mesmo critério de `replaceUncertainNotification`: mesmo dia, ou nome igual/contido.
					(t.date === input.date || nameSimilarity(t.merchantName ?? t.description, input.description) >= 1),
			)
		) {
			return true;
		}
	}
	const rows = await transactions.listByTarget(target, {
		from: addDays(input.date, -EARLY_WINDOW_DAYS),
		to: addDays(input.date, EARLY_WINDOW_DAYS),
	});
	const name = normalizeMerchantName(input.description);
	return rows.some(
		(t) =>
			t.kind === input.kind &&
			t.amountCents === input.amountCents &&
			t.installmentNumber === null &&
			(t.source === "pluggy" ||
				// O dono já lançou à mão (ou importou) a mesma compra no mesmo dia: não cria outra igual.
				(t.source !== NOTIFICATION_SOURCE &&
					t.date === input.date &&
					name !== "" &&
					normalizeMerchantName(t.description) === name)),
	);
}

/** Quanto para trás se procura a compra que o banco avisa ter cancelado (a notificação de cancelamento pode atrasar). */
const CANCEL_LOOKBACK_DAYS = 7;

/**
 * "Compra cancelada": desfaz o lançamento que a notificação da compra criou (mesmo cartão, valor, loja e dias
 * próximos), pelo mesmo caminho de uma compra pendente que o banco deixa de informar: sai da lista (exclusão lógica)
 * e, se o dono já mexeu nela, só vai para "Para revisar" com a nota. Nunca cria gasto negativo. Sem lançamento
 * correspondente (a compra nunca foi lançada, ou o banco já a trouxe pelo Open Finance): some em silêncio, e a compra
 * que ainda esperava na lista "Não consegui lançar" sai dela, porque não vai mais acontecer.
 */
async function cancelPurchase(deps: NotificationDeps, n: Resolved, cancel: CancelledPurchase): Promise<void> {
	const { cards, transactions, notificationInbox } = deps.stores;
	const when = n.postedAt.getTime() > deps.now().getTime() ? deps.now() : n.postedAt;
	const day = toLocalDate(when);
	const all = await cards.list();
	// Pelo final, quando o final já é conhecido; senão qualquer cartão do banco (valor, loja e data seguem valendo).
	const known = await resolveCard(deps.stores, n.app, cancel.last4, false);
	const candidates = known ? [known.card] : all.filter(isActive).filter(bankMatcher(n.app));
	const found: TransactionRecord[] = [];
	for (const card of candidates) {
		const rows = await transactions.listByTarget(
			{ cardId: card.id },
			{ from: addDays(day, -CANCEL_LOOKBACK_DAYS), to: addDays(day, 1) },
		);
		found.push(
			...rows.filter(
				(t) =>
					t.source === NOTIFICATION_SOURCE &&
					t.bankPending &&
					t.kind === "expense" &&
					t.amountCents === cancel.amountCents &&
					t.installmentNumber === null &&
					cancel.merchant !== null &&
					nameSimilarity(t.merchantName ?? t.description, cancel.merchant) >= 1,
			),
		);
	}
	// A mais recente (a compra cancelada costuma ser a última igual); empate: a criada por último.
	const target = found.sort(
		(a, b) =>
			(a.date < b.date ? 1 : a.date > b.date ? -1 : 0) || b.createdAt.getTime() - a.createdAt.getTime(),
	)[0];
	if (target) {
		const now = deps.now();
		const removed = !touchedByOwner(target) && (await transactions.removeByBank(target.id, now));
		if (!removed) {
			await transactions.flagMissingByBank(target.id, now, {
				status: "pending",
				note: target.note ?? CANCELLED_NOTE,
			});
		}
		return;
	}
	for (const row of await notificationInbox.list()) {
		if (row.app !== n.app || row.postedAt.getTime() > n.postedAt.getTime()) continue;
		const parsed = parseNotification({ app: row.app, title: row.title, text: row.text });
		if (
			parsed.outcome === "parsed" &&
			parsed.data.kind === "credit_purchase" &&
			parsed.data.amountCents === cancel.amountCents &&
			parsed.data.last4 === cancel.last4 &&
			cancel.merchant !== null &&
			nameSimilarity(parsed.data.merchant ?? "", cancel.merchant) >= 1
		) {
			await notificationInbox.remove(row.id);
		}
	}
}

/** `dismissed`: não é lançamento nem falha (propaganda, aviso, cancelamento tratado): quem espera na lista sai dela. */
type Outcome = NotificationResult | "dismissed";

/** Resultado da tentativa; `inbox` diz por que a notificação foi para a lista. */
async function process(deps: NotificationDeps, prefs: PreferencesRecord, n: Resolved): Promise<Outcome> {
	const { transactions, notificationInbox } = deps.stores;
	const result = parseNotification({ app: n.app, title: n.title, text: n.text });
	const toInbox = async (reason: NotificationInboxReason) => {
		await notificationInbox.purgeOlderThan(new Date(deps.now().getTime() - INBOX_MAX_AGE_DAYS * 86_400_000));
		await notificationInbox.add({
			key: n.key,
			app: n.app,
			title: n.title,
			text: n.text,
			reason,
			postedAt: n.postedAt,
		});
		return "inbox" as const;
	};
	if (result.outcome === "skip") return "dismissed";
	if (result.outcome === "cancelled") {
		await cancelPurchase(deps, n, result.data);
		return "dismissed";
	}
	if (result.outcome === "unrecognized") {
		// Sem valor em R$ é propaganda; e o dono pode ter desligado a lista.
		if (!result.hasAmount) return "dismissed";
		return prefs.notificationToReview ? toInbox(result.reason) : "ignored";
	}
	// A data é a do momento em que o Android registrou (nunca no futuro, mesmo com o relógio do aparelho errado).
	const posted = n.postedAt.getTime() > deps.now().getTime() ? deps.now() : n.postedAt;
	const built = await build(deps, prefs, n, result.data, toLocalDate(posted));
	if ("missing" in built) return toInbox("target");
	if (!(await transactions.findByExternal(NOTIFICATION_SOURCE, n.key))) {
		if (await repostedRecently(transactions, n.key)) return "duplicate";
		const otherCards =
			result.data.uncertainTarget && built.input.accountId
				? await sameBankCardIds(
						deps.stores,
						(await deps.stores.accounts.get(built.input.accountId))?.bankCode ?? null,
					)
				: [];
		if (await alreadyInBank(transactions, built.input, otherCards)) return "duplicate";
	}
	const saved = await transactions.upsertByExternal(NOTIFICATION_SOURCE, n.key, built.input);
	// Apagado pelo dono antes: não recria. Já existia: é repetição.
	return saved.created ? "created" : "duplicate";
}

/**
 * Trata uma notificação que veio do aparelho. Confere de novo, no servidor, o que o aparelho já filtrou: pacote da
 * lista, leitura ligada, banco ligado e nada que pareça código de verificação.
 */
export async function ingestNotification(
	deps: NotificationDeps,
	item: NotificationItem,
): Promise<NotificationResult> {
	const app = notificationAppOfPackage(item.package);
	if (app === null) return "ignored";
	const prefs = await deps.stores.preferences.get();
	if (!prefs.notificationCapture || !prefs.notificationApps.includes(app)) return "ignored";
	if (isSensitiveNotification(item.title, item.text)) return "discarded";
	const outcome = await process(deps, prefs, {
		app,
		title: item.title,
		text: item.text,
		postedAt: new Date(item.postedAt),
		key: notificationKey(item),
	});
	return outcome === "dismissed" ? "ignored" : outcome;
}

/**
 * Tenta de novo o que esperava na lista "Não entendi" (o dono cadastrou o cartão, o parser melhorou). A que virar
 * lançamento (ou já era), ou que agora se sabe não ser movimentação (propaganda) ou ser cancelamento tratado, sai da
 * lista; as outras ficam como estavam. Da mais antiga para a mais nova: o cancelamento só acha a compra se ela já foi
 * lançada nesta mesma rodada.
 */
export async function retryNotificationInbox(
	deps: NotificationDeps,
): Promise<{ created: number; remaining: number }> {
	const { notificationInbox } = deps.stores;
	const prefs = await deps.stores.preferences.get();
	let created = 0;
	const rows = [...(await notificationInbox.list())].sort(
		(a, b) => a.postedAt.getTime() - b.postedAt.getTime(),
	);
	for (const row of rows) {
		const outcome = await process(deps, prefs, {
			app: row.app,
			title: row.title,
			text: row.text,
			postedAt: row.postedAt,
			key: row.key,
		});
		if (outcome === "created" || outcome === "duplicate" || outcome === "dismissed") {
			await notificationInbox.remove(row.id);
			if (outcome === "created") created++;
		}
	}
	return { created, remaining: await notificationInbox.count() };
}

/** Cartões que o dono pode escolher para uma notificação que está na lista por "não achei o cartão". */
export interface InboxCardChoice {
	last4: string;
	cards: { id: string; name: string; last4: string | null }[];
}

/**
 * Para a notificação de compra na lista cujo final não leva a um cartão só: os cartões do banco (ou, se o banco não
 * tem nenhum identificado, todos os ativos) para o dono escolher uma vez. `null`: não há o que escolher.
 */
export async function inboxCardChoice(
	deps: Pick<NotificationDeps, "stores">,
	row: { app: NotificationApp; title: string; text: string; reason: NotificationInboxReason },
): Promise<InboxCardChoice | null> {
	if (row.reason !== "target") return null;
	const parsed = parseNotification({ app: row.app, title: row.title, text: row.text });
	if (parsed.outcome !== "parsed" || parsed.data.kind !== "credit_purchase" || parsed.data.last4 === null) {
		return null;
	}
	const active = (await deps.stores.cards.list()).filter(isActive);
	const sameBank = active.filter(bankMatcher(row.app));
	const pool = sameBank.length > 0 ? sameBank : active;
	if (pool.length === 0) return null;
	return {
		last4: parsed.data.last4,
		cards: pool.map((c) => ({ id: c.id, name: c.name, last4: c.last4 })),
	};
}

/**
 * O dono escolheu o cartão de uma notificação da lista: o app lembra o final → cartão (as próximas já caem nele) e a
 * notificação é lançada. `created: false` se já estava lançada. Só vale para compra com final e cartão ativo.
 */
export async function chooseInboxCard(
	deps: NotificationDeps,
	inboxId: string,
	cardId: string,
): Promise<{ created: boolean }> {
	const { notificationInbox, cards, notificationCardLinks } = deps.stores;
	const row = (await notificationInbox.list()).find((r) => r.id === inboxId);
	if (!row) throw new DataError("not_found", "Notificação não encontrada.");
	const parsed = parseNotification({ app: row.app, title: row.title, text: row.text });
	if (parsed.outcome !== "parsed" || parsed.data.kind !== "credit_purchase" || parsed.data.last4 === null) {
		throw new DataError("invalid", "Esta notificação não tem final de cartão para ligar.");
	}
	const card = await cards.get(cardId);
	if (!card || card.archivedAt !== null) throw new DataError("not_found", "Cartão não encontrado.");
	await notificationCardLinks.set(row.app, parsed.data.last4, card.id);
	const outcome = await process(deps, await deps.stores.preferences.get(), {
		app: row.app,
		title: row.title,
		text: row.text,
		postedAt: row.postedAt,
		key: row.key,
	});
	if (outcome === "created" || outcome === "duplicate") await notificationInbox.remove(row.id);
	return { created: outcome === "created" };
}
