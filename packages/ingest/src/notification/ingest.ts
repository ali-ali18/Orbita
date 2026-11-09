import { createHash } from "node:crypto";
import { addDays, invoiceFor, type LocalDate, toLocalDate } from "@orbita/core";
import {
	type AccountRecord,
	type CardRecord,
	type PreferencesRecord,
	type Stores,
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
import { EARLY_WINDOW_DAYS } from "../pluggy/early.ts";
import { type ParsedNotification, parseNotification } from "./parse.ts";

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

export const UNCERTAIN_TARGET_NOTE =
	"Pago a um estabelecimento sem dizer se foi no saldo ou no cartão do Mercado Pago. Confira a conta e o cartão para não ficar duplicado.";
export const UNVERIFIED_BANK_NOTE =
	"Lido da notificação de um banco cujo formato ainda não foi conferido. Confira o valor e o estabelecimento.";

export interface NotificationDeps {
	stores: Pick<
		Stores,
		"accounts" | "cards" | "transactions" | "categoryRules" | "preferences" | "notificationInbox"
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
	const { accounts, cards, categoryRules } = deps.stores;
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
			const card = pickCard(n.app, await cards.list(), parsed.last4);
			if (!card) return { missing: true };
			const rule = pickCategoryRule(await categoryRules.list(), description);
			return {
				input: {
					...base,
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
			const card = pickCard(n.app, await cards.list(), parsed.last4);
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
): Promise<boolean> {
	const target = input.cardId
		? { cardId: input.cardId }
		: input.accountId
			? { accountId: input.accountId }
			: null;
	if (target === null) return false;
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

/** Resultado da tentativa; `inbox` diz por que a notificação foi para a lista. */
async function process(
	deps: NotificationDeps,
	prefs: PreferencesRecord,
	n: Resolved,
): Promise<NotificationResult> {
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
	if (result.outcome === "skip") return "ignored";
	if (result.outcome === "unrecognized") {
		// Sem valor em R$ é propaganda; e o dono pode ter desligado a lista.
		return result.hasAmount && prefs.notificationToReview ? toInbox(result.reason) : "ignored";
	}
	// A data é a do momento em que o Android registrou (nunca no futuro, mesmo com o relógio do aparelho errado).
	const posted = n.postedAt.getTime() > deps.now().getTime() ? deps.now() : n.postedAt;
	const built = await build(deps, prefs, n, result.data, toLocalDate(posted));
	if ("missing" in built) return toInbox("target");
	if (!(await transactions.findByExternal(NOTIFICATION_SOURCE, n.key))) {
		if (await repostedRecently(transactions, n.key)) return "duplicate";
		if (await alreadyInBank(transactions, built.input)) return "duplicate";
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
	return process(deps, prefs, {
		app,
		title: item.title,
		text: item.text,
		postedAt: new Date(item.postedAt),
		key: notificationKey(item),
	});
}

/**
 * Tenta de novo o que esperava na lista "Não entendi" (o dono cadastrou o cartão, o parser melhorou). A que virar
 * lançamento (ou já era) sai da lista; as outras ficam como estavam.
 */
export async function retryNotificationInbox(
	deps: NotificationDeps,
): Promise<{ created: number; remaining: number }> {
	const { notificationInbox } = deps.stores;
	const prefs = await deps.stores.preferences.get();
	let created = 0;
	for (const row of await notificationInbox.list()) {
		const outcome = await process(deps, prefs, {
			app: row.app,
			title: row.title,
			text: row.text,
			postedAt: row.postedAt,
			key: row.key,
		});
		if (outcome === "created" || outcome === "duplicate") {
			await notificationInbox.remove(row.id);
			if (outcome === "created") created++;
		}
	}
	return { created, remaining: await notificationInbox.count() };
}
