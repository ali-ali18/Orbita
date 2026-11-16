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
		| "notificationCancellations"
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
	/** O dono disse "é compra" a esta oferta oculta: não se oculta de novo. */
	ownerKept?: boolean;
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
	// O cartão do banco com este final exato vence qualquer ligação aprendida (que então fica sem uso).
	const exact = pickCard(app, all, last4);
	if (exact) return { card: exact };
	const sameBank = all.filter(isActive).filter(bankMatcher(app));
	if (last4 !== null) {
		const link = await stores.notificationCardLinks.get(app, last4);
		const linked = link ? all.find((c) => c.id === link.cardId && isActive(c)) : undefined;
		// Palpite só vale enquanto o banco tiver esse cartão como o único ativo; com mais de um, o dono escolhe.
		const valid = link?.origin === "choice" || (sameBank.length === 1 && sameBank[0]?.id === link?.cardId);
		if (linked && valid) return { card: linked };
	}
	// O final é de mais de um cartão do banco (ambíguo): nunca se adivinha nem se aprende.
	if (last4 !== null && sameBank.some((c) => c.last4 === last4)) return null;
	if (!learn || last4 === null) return null;
	if (sameBank.length !== 1) return null;
	const card = sameBank[0] as CardRecord;
	await stores.notificationCardLinks.set(app, last4, card.id, "guess");
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
/** Cancelamento que chega antes da compra espera tanto tempo por ela (e ela precisa ser de até tanto antes dele). */
const EARLY_CANCEL_HOURS = 48;
/** Registros de cancelamento mais velhos que isto saem. */
const CANCEL_KEEP_DAYS = 7;

/** Acrescenta o aviso de cancelamento à nota que já existe (nunca o omite, nunca o repete). */
const withCancelNote = (note: string | null) =>
	note === null ? CANCELLED_NOTE : note.includes(CANCELLED_NOTE) ? note : `${note} ${CANCELLED_NOTE}`;

/** A mesma notificação repostada em minuto vizinho tem a mesma parte estável da chave. */
const neighborKeys = (key: string): string[] => {
	const m = /^n:([0-9a-f]+):(\d+)$/.exec(key);
	if (!m) return [key];
	const minute = Number(m[2]);
	const out: string[] = [];
	for (let d = -REPOST_WINDOW_MINUTES; d <= REPOST_WINDOW_MINUTES; d++) out.push(`n:${m[1]}:${minute + d}`);
	return out;
};

/**
 * "Compra cancelada": desfaz o lançamento que a notificação da compra criou (mesmo cartão, valor, loja e dias
 * próximos), pelo mesmo caminho de uma compra pendente que o banco deixa de informar: sai da lista (exclusão lógica)
 * e, se o dono já mexeu nela ou ela já tem nota, fica em "Para revisar" com a nota de cancelamento acrescentada.
 * Nunca cria gasto negativo. A notificação de cancelamento é registrada pela chave: repetida, não cancela uma segunda
 * compra igual. Sem lançamento correspondente, o cancelamento fica guardado (`EARLY_CANCEL_HOURS`) para anular a
 * compra se ela chegar depois; a compra que esperava na lista "Não consegui lançar" sai dela.
 */
async function cancelPurchase(deps: NotificationDeps, n: Resolved, cancel: CancelledPurchase): Promise<void> {
	const { cards, transactions, notificationInbox, notificationCancellations } = deps.stores;
	if (await notificationCancellations.hasAny(neighborKeys(n.key))) return;
	const now = deps.now();
	await notificationCancellations.purgeOlderThan(new Date(now.getTime() - CANCEL_KEEP_DAYS * 86_400_000));
	const base = {
		key: n.key,
		app: n.app,
		last4: cancel.last4,
		amountCents: cancel.amountCents,
		merchant: cancel.merchant,
		postedAt: n.postedAt,
	};
	const when = n.postedAt.getTime() > now.getTime() ? now : n.postedAt;
	const day = toLocalDate(when);
	const all = await cards.list();
	// Pelo final, quando o final já é conhecido; senão qualquer cartão do banco, e então só vale a loja IGUAL.
	const known = await resolveCard(deps.stores, n.app, cancel.last4, false);
	const candidates = known ? [known.card] : all.filter(isActive).filter(bankMatcher(n.app));
	const minSimilarity = known ? 1 : 2;
	const found: { t: TransactionRecord; score: number }[] = [];
	for (const card of candidates) {
		const rows = await transactions.listByTarget(
			{ cardId: card.id },
			{ from: addDays(day, -CANCEL_LOOKBACK_DAYS), to: addDays(day, 1) },
		);
		for (const t of rows) {
			if (
				t.kind !== "expense" ||
				t.amountCents !== cancel.amountCents ||
				t.installmentNumber !== null ||
				cancel.merchant === null ||
				t.note?.includes(CANCELLED_NOTE)
			) {
				continue;
			}
			const score = nameSimilarity(t.merchantName ?? t.description, cancel.merchant);
			if (score >= minSimilarity) found.push({ t, score });
		}
	}
	// A loja mais parecida primeiro; depois a data mais recente (a compra cancelada costuma ser a última igual); depois
	// a criada por último.
	found.sort(
		(a, b) =>
			b.score - a.score ||
			(a.t.date < b.t.date ? 1 : a.t.date > b.t.date ? -1 : 0) ||
			b.t.createdAt.getTime() - a.t.createdAt.getTime(),
	);
	const target = found[0]?.t;
	let used = false;
	if (target) {
		used = true;
		if (target.source === NOTIFICATION_SOURCE && target.bankPending) {
			const removed =
				!touchedByOwner(target) && target.note === null && (await transactions.removeByBank(target.id, now));
			if (!removed) {
				await transactions.flagMissingByBank(target.id, now, {
					status: "pending",
					note: withCancelNote(target.note),
				});
			}
		} else {
			// O Open Finance já adotou a compra (ou é de outra origem): o banco é a fonte da verdade e o cancelamento
			// pode ser de outra compra igual. Nada é apagado: vai para "Para revisar" com a nota.
			await transactions.update(target.id, { status: "pending", note: withCancelNote(target.note) });
		}
	} else {
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
				used = true;
			}
		}
	}
	await notificationCancellations.register({ ...base, consumed: used });
}

/**
 * Cancelamento que chegou ANTES desta compra (a fila do aparelho entrega fora de ordem): se há um à espera com o mesmo
 * valor, final e loja, de até `EARLY_CANCEL_HOURS` depois da compra, ele a anula. `true` só para quem o usou.
 */
async function takeEarlyCancel(
	deps: NotificationDeps,
	n: Resolved,
	data: ParsedNotification,
): Promise<boolean> {
	if (data.kind !== "credit_purchase" || data.last4 === null || data.merchant === null) return false;
	const since = new Date(deps.now().getTime() - EARLY_CANCEL_HOURS * 3_600_000);
	for (const c of await deps.stores.notificationCancellations.listPending(n.app, since)) {
		const gap = c.postedAt.getTime() - n.postedAt.getTime();
		if (
			c.amountCents === data.amountCents &&
			c.last4 === data.last4 &&
			c.merchant !== null &&
			nameSimilarity(c.merchant, data.merchant) >= 1 &&
			gap >= 0 &&
			gap <= EARLY_CANCEL_HOURS * 3_600_000 &&
			(await deps.stores.notificationCancellations.consume(c.key))
		) {
			return true;
		}
	}
	return false;
}

/**
 * `dismissed`: não é lançamento nem falha (aviso, compra recusada, cancelamento tratado): quem espera na lista sai dela.
 * `hidden`: parece oferta; fica GUARDADA na caixa, oculta (motivo "promo"), nunca apagada por ser oferta.
 */
type Outcome = NotificationResult | "dismissed" | "hidden";

/** Resultado da tentativa; `inbox` diz por que a notificação foi para a lista. */
async function process(deps: NotificationDeps, prefs: PreferencesRecord, n: Resolved): Promise<Outcome> {
	const { transactions, notificationInbox } = deps.stores;
	const result = parseNotification({ app: n.app, title: n.title, text: n.text });
	const toInbox = async (reason: NotificationInboxReason) => {
		await notificationInbox.purgeOlderThan(new Date(deps.now().getTime() - INBOX_MAX_AGE_DAYS * 86_400_000));
		const { created } = await notificationInbox.add({
			key: n.key,
			app: n.app,
			title: n.title,
			text: n.text,
			reason,
			postedAt: n.postedAt,
		});
		// Já estava na caixa (tentar de novo): só o marcador muda.
		if (!created) await notificationInbox.setReason(n.key, reason);
		return "inbox" as const;
	};
	if (result.outcome === "skip") {
		if (result.reason !== "promo") return "dismissed";
		// Oferta: nada com R$ some sem rastro. Guardada e oculta, a menos que o dono tenha desligado a lista.
		if (!prefs.notificationToReview) return "ignored";
		await toInbox(n.ownerKept ? "format" : "promo");
		return "hidden";
	}
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
	if ("missing" in built) {
		// Já cancelada antes de chegar: não há o que mostrar ao dono.
		return (await takeEarlyCancel(deps, n, result.data)) ? "dismissed" : toInbox("target");
	}
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
	if (!saved.created) return "duplicate";
	// O banco já tinha avisado o cancelamento (a notificação dele chegou primeiro): o lançamento nasce e sai na hora, e
	// fica o registro dele (a mesma compra reenviada não volta).
	if (await takeEarlyCancel(deps, n, result.data)) {
		await transactions.removeByBank(saved.transaction.id, deps.now());
		return "dismissed";
	}
	return "created";
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
	return outcome === "dismissed" || outcome === "hidden" ? "ignored" : outcome;
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
			ownerKept: row.ownerKept,
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
 * Para cada notificação de compra da lista cujo final não leva a um cartão só: os cartões do banco (ou, se o banco não
 * tem nenhum identificado, todos os ativos) para o dono escolher uma vez. `null`: não há o que escolher. Os cartões
 * são lidos uma vez só, para a lista toda.
 */
export async function inboxCardChoices(
	deps: Pick<NotificationDeps, "stores">,
	rows: readonly { app: NotificationApp; title: string; text: string; reason: NotificationInboxReason }[],
): Promise<(InboxCardChoice | null)[]> {
	if (!rows.some((r) => r.reason === "target")) return rows.map(() => null);
	const active = (await deps.stores.cards.list()).filter(isActive);
	return rows.map((row) => {
		if (row.reason !== "target") return null;
		const parsed = parseNotification({ app: row.app, title: row.title, text: row.text });
		if (parsed.outcome !== "parsed" || parsed.data.kind !== "credit_purchase" || parsed.data.last4 === null) {
			return null;
		}
		const sameBank = active.filter(bankMatcher(row.app));
		const pool = sameBank.length > 0 ? sameBank : active;
		if (pool.length === 0) return null;
		return {
			last4: parsed.data.last4,
			cards: pool.map((c) => ({ id: c.id, name: c.name, last4: c.last4 })),
		};
	});
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
	// Só vale um dos cartões que a lista ofereceu para esta notificação.
	const [offered] = await inboxCardChoices(deps, [row]);
	if (!offered?.cards.some((c) => c.id === card.id)) {
		throw new DataError("invalid", "Escolha um dos cartões oferecidos para esta compra.");
	}
	await notificationCardLinks.set(row.app, parsed.data.last4, card.id, "choice");
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
