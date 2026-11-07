import { addDays, addMonths, decimalToCents, type MonthKey, toLocalDate } from "@orbita/core";
import {
	type AccountRecord,
	type CardRecord,
	DataError,
	type PluggyConnectionRecord,
	type Stores,
	toCardConfig,
} from "@orbita/db";
import type { PluggySyncStatus, SecretName } from "@orbita/shared";
import { createPluggyClient, type PluggyClient, type PluggyFetch } from "./client.ts";
import { PluggyError, safeErrorMessage } from "./errors.ts";
import {
	type BillPayment,
	mapPluggyAccount,
	mapPluggyTransaction,
	PLUGGY_SOURCE,
	pluggyDateToLocal,
	type SkipReason,
	type TransactionContext,
} from "./mapping.ts";
import type { PluggyAccount, PluggyTransaction } from "./schemas.ts";

export const PLUGGY_SYNC_QUEUE = "sincronizacao";
/** Job agendado (todo dia, 06:00 em São Paulo). */
export const PLUGGY_DAILY_JOB = "pluggy-diario";
/** Job pedido pelo app. O id fixo faz pedidos repetidos virarem um só enquanto um está na fila. */
export const PLUGGY_MANUAL_JOB = "pluggy-agora";
export const PLUGGY_MANUAL_JOB_ID = "pluggy-agora";

/** Primeira sincronização de uma conexão: quantos dias para trás. */
export const FIRST_SYNC_DAYS = 90;
/** Depois: recomeça tantos dias antes da última sincronização boa (o Pluggy efetiva lançamentos com atraso). */
export const OVERLAP_DAYS = 7;
/** Estorno procura a compra original nas faturas dos últimos N meses. */
const REFUND_LOOKBACK_MONTHS = 3;

export interface SyncPluggyDeps {
	stores: Pick<Stores, "accounts" | "cards" | "transactions" | "pluggyConnections">;
	/** Lê uma chave do cofre (`vault.read`). Devolve `null` se não cadastrada; pode lançar se não abre. */
	readSecret: (
		name: Extract<SecretName, "pluggy_client_id" | "pluggy_client_secret">,
	) => Promise<string | null>;
	fetch: PluggyFetch;
	now: () => Date;
	/** Só contagens e nomes de etapa; nunca chave, token ou corpo de resposta. */
	log?: (line: string) => void;
	/** Para testes: troca o cliente real. */
	createClient?: typeof createPluggyClient;
}

export interface ConnectionSyncResult {
	id: string;
	status: PluggySyncStatus;
	error: string | null;
	accounts: number;
	created: number;
	existing: number;
	failed: number;
	skipped: Partial<Record<SkipReason | "archived_account", number>>;
	/** Avisos que não são erro (conta ignorada, por exemplo). Sem segredo. */
	notes: string[];
}

export interface SyncPluggyResult {
	status: "no_keys" | "no_connections" | PluggySyncStatus;
	connections: ConnectionSyncResult[];
}

// Estados de Item do SDK (ITEM_STATUSES) em que o banco espera o dono: reconectar ou autorizar.
const NEEDS_USER = new Set(["LOGIN_ERROR", "WAITING_USER_INPUT", "WAITING_USER_ACTION"]);

const plain = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

/**
 * Sincroniza o Meu Pluggy: para cada conexão cadastrada, contas → cartões → lançamentos.
 *
 * - Idempotente: o lançamento é gravado por `upsertByExternal("pluggy", id do Pluggy)`; rodar de novo não duplica
 *   nem altera o que já está gravado. Conta e cartão são ligados por `findByExternal`.
 * - Janela: primeira vez, 90 dias; depois, desde `lastSyncAt` menos 7 dias. `lastSyncAt` só avança quando a
 *   conexão termina `ok` (um `partial` repete a janela na próxima).
 * - Sem chaves: grava "no_keys" em cada conexão e sai, sem erro e sem chamar o Pluggy.
 * - O que o Pluggy trouxe é `confirmed`. Lançamentos `PENDING` do Pluggy ficam de fora (o id pode mudar ao efetivar).
 * - Nunca lança por causa de uma conexão: o erro vira o `lastError` (já sanitizado) daquela conexão.
 */
export async function syncPluggy(deps: SyncPluggyDeps): Promise<SyncPluggyResult> {
	const { stores, now } = deps;
	const log = deps.log ?? (() => {});
	const connections = await stores.pluggyConnections.list();
	if (connections.length === 0) return { status: "no_connections", connections: [] };

	let clientId: string | null;
	let clientSecret: string | null;
	try {
		clientId = await deps.readSecret("pluggy_client_id");
		clientSecret = await deps.readSecret("pluggy_client_secret");
	} catch {
		const error =
			"Não deu para abrir as chaves do Pluggy (o APP_SECRET do servidor mudou?). Cadastre-as de novo.";
		const results = await Promise.all(connections.map((c) => finish(deps, c, blank(c.id, "error", error))));
		return { status: "error", connections: results };
	}
	if (!clientId || !clientSecret) {
		const results = await Promise.all(connections.map((c) => finish(deps, c, blank(c.id, "no_keys", null))));
		log("pluggy: sem chaves cadastradas");
		return { status: "no_keys", connections: results };
	}

	const client = (deps.createClient ?? createPluggyClient)({
		fetch: deps.fetch,
		clientId,
		clientSecret,
		now,
	});
	const startedAt = now();
	const results: ConnectionSyncResult[] = [];
	for (const connection of connections) {
		const result = await syncConnection(deps, client, connection, startedAt);
		results.push(await finish(deps, connection, result, startedAt));
		log(
			`pluggy: ${result.status} contas=${result.accounts} novos=${result.created} existentes=${result.existing}`,
		);
	}
	const statuses = new Set(results.map((r) => r.status));
	const status: PluggySyncStatus = statuses.has("error")
		? statuses.size === 1
			? "error"
			: "partial"
		: statuses.has("partial")
			? "partial"
			: "ok";
	return { status, connections: results };
}

function blank(id: string, status: PluggySyncStatus, error: string | null): ConnectionSyncResult {
	return { id, status, error, accounts: 0, created: 0, existing: 0, failed: 0, skipped: {}, notes: [] };
}

async function finish(
	deps: SyncPluggyDeps,
	connection: PluggyConnectionRecord,
	result: ConnectionSyncResult,
	startedAt?: Date,
): Promise<ConnectionSyncResult> {
	await deps.stores.pluggyConnections.recordSync(connection.id, {
		status: result.status,
		error: result.error,
		...(result.status === "ok" && startedAt ? { syncedAt: startedAt } : {}),
	});
	return result;
}

async function syncConnection(
	deps: SyncPluggyDeps,
	client: PluggyClient,
	connection: PluggyConnectionRecord,
	startedAt: Date,
): Promise<ConnectionSyncResult> {
	const result = blank(connection.id, "ok", null);
	try {
		const today = toLocalDate(startedAt);
		const from = connection.lastSyncAt
			? addDays(toLocalDate(connection.lastSyncAt), -OVERLAP_DAYS)
			: addDays(today, -FIRST_SYNC_DAYS);

		const item = await client.item(connection.id);
		if (NEEDS_USER.has(item.status)) {
			result.status = "error";
			result.error =
				"O banco pediu para você reconectar. Abra o Meu Pluggy, atualize a conexão e sincronize de novo.";
			return result;
		}
		const pluggyAccounts = await client.accounts(connection.id);
		const linked = await linkAccounts(deps, pluggyAccounts, item.connector?.name, result);
		// Um pagamento de fatura feito pela conta só sabe qual cartão quita se há um único cartão na conexão.
		const liveCards = linked.filter((l) => l.card !== null && l.card.archivedAt === null);
		const paymentCardId = liveCards.length === 1 ? (liveCards[0]?.card?.id ?? null) : null;

		// Pagamentos de fatura registrados no Pluggy: deixam casar o débito da conta com o cartão certo.
		// Faturas podem não existir para o conector; sem elas, vale o plano B por categoria.
		const billPayments: BillPayment[] = [];
		for (const target of liveCards) {
			try {
				for (const bill of await client.bills(target.pluggyId)) {
					for (const p of bill.payments) {
						const date = pluggyDateToLocal(p.paymentDate);
						if (date === null || (p.currencyCode && p.currencyCode !== "BRL")) continue;
						try {
							const amountCents = Math.abs(decimalToCents(p.amount));
							if (amountCents > 0)
								billPayments.push({ cardId: target.card?.id as string, amountCents, date });
						} catch {
							// valor fora do que o Órbita aceita: ignora este pagamento
						}
					}
				}
			} catch (e) {
				if (e instanceof PluggyError && (e.code === "auth" || e.code === "rate_limit")) throw e;
			}
		}

		let failedAccounts = 0;
		for (const target of linked) {
			if ((target.account ?? target.card)?.archivedAt) {
				bump(result.skipped, "archived_account");
				continue;
			}
			try {
				const txs = await client.transactions({ accountId: target.pluggyId, from, to: today });
				const ctx: TransactionContext = {
					accountType: target.account ? "BANK" : "CREDIT",
					accountId: target.account?.id ?? null,
					card: target.card ? { id: target.card.id, config: toCardConfig(target.card) } : null,
					paymentCardId,
					ownerTaxNumber: target.taxNumber,
					billPayments,
				};
				await storeTransactions(deps, txs, ctx, result);
			} catch (e) {
				if (e instanceof PluggyError && (e.code === "auth" || e.code === "rate_limit")) throw e;
				failedAccounts += 1;
				result.notes.push(`Uma conta não sincronizou: ${safeErrorMessage(e)}`);
			}
		}
		if (failedAccounts > 0 || result.failed > 0) {
			result.status = "partial";
			const parts = [
				failedAccounts > 0 ? `${failedAccounts} conta(s) não sincronizaram` : null,
				result.failed > 0 ? `${result.failed} lançamento(s) não puderam ser gravados` : null,
			].filter(Boolean);
			result.error = `${parts.join("; ")}. Na próxima sincronização o Órbita tenta de novo.`;
		}
		return result;
	} catch (e) {
		result.status = "error";
		result.error = safeErrorMessage(e);
		return result;
	}
}

interface Linked {
	pluggyId: string;
	taxNumber: string | null;
	account: AccountRecord | null;
	card: CardRecord | null;
}

/** Acha ou cria a conta/cartão do Órbita de cada conta do Pluggy. */
async function linkAccounts(
	deps: SyncPluggyDeps,
	pluggyAccounts: readonly PluggyAccount[],
	connectorName: string | null | undefined,
	result: ConnectionSyncResult,
): Promise<Linked[]> {
	const { accounts, cards } = deps.stores;
	const out: Linked[] = [];
	for (const pa of pluggyAccounts) {
		const mapped = mapPluggyAccount(pa, connectorName);
		if (mapped.kind === "ignored") {
			// Tipos que o Órbita não usa (investimento) são normais; o resto merece aviso.
			if (pa.type === "BANK" || pa.type === "CREDIT") result.notes.push(`Conta ignorada: ${mapped.reason}.`);
			continue;
		}
		result.accounts += 1;
		if (mapped.kind === "account") {
			let account = await accounts.findByExternal(PLUGGY_SOURCE, mapped.externalId);
			if (!account) {
				try {
					account = await accounts.create(mapped.input);
				} catch (e) {
					if (!(e instanceof DataError && e.code === "duplicate")) throw e;
					account = await accounts.findByExternal(PLUGGY_SOURCE, mapped.externalId);
				}
			}
			out.push({ pluggyId: pa.id, taxNumber: pa.taxNumber ?? null, account, card: null });
			continue;
		}
		let card = await cards.findByExternal(PLUGGY_SOURCE, mapped.externalId);
		if (!card) {
			try {
				card = await cards.create(mapped.input);
			} catch (e) {
				if (!(e instanceof DataError && e.code === "duplicate")) throw e;
				card = await cards.findByExternal(PLUGGY_SOURCE, mapped.externalId);
			}
		} else if (
			card.archivedAt === null &&
			mapped.input.limitCents != null &&
			mapped.input.limitCents !== card.limitCents
		) {
			// Fechamento e vencimento o dono pode ter ajustado à mão; só o limite acompanha o banco.
			card = await cards.update(card.id, { limitCents: mapped.input.limitCents });
		}
		out.push({ pluggyId: pa.id, taxNumber: pa.taxNumber ?? null, account: null, card });
	}
	return out;
}

const bump = (counts: ConnectionSyncResult["skipped"], key: SkipReason | "archived_account") => {
	counts[key] = (counts[key] ?? 0) + 1;
};

async function storeTransactions(
	deps: SyncPluggyDeps,
	txs: Awaited<ReturnType<PluggyClient["transactions"]>>,
	ctx: TransactionContext,
	result: ConnectionSyncResult,
): Promise<void> {
	const { transactions } = deps.stores;
	// Estornos por último: assim a compra original, se veio na mesma resposta, já está gravada.
	const mappedAll = txs.map((tx) => ({ tx, mapped: safeMap(tx, ctx) }));
	const ordered = [
		...mappedAll.filter((m) => m.mapped?.action !== "refund"),
		...mappedAll.filter((m) => m.mapped?.action === "refund"),
	];
	for (const { mapped } of ordered) {
		try {
			if (mapped === null) {
				result.failed += 1;
				continue;
			}
			if (mapped.action === "skip") {
				bump(result.skipped, mapped.reason);
				continue;
			}
			if (mapped.action === "upsert") {
				const res = await transactions.upsertByExternal(PLUGGY_SOURCE, mapped.externalId, mapped.input);
				if (res.created) result.created += 1;
				else result.existing += 1;
				continue;
			}
			// Estorno: só entra se a compra original está gravada. Sem ela, fica de fora e a próxima rodada tenta de novo.
			if (await transactions.existsByExternal(PLUGGY_SOURCE, mapped.externalId)) {
				result.existing += 1;
				continue;
			}
			const originalId = ctx.card
				? await findRefundOriginal(
						transactions,
						ctx.card,
						mapped.original,
						mapped.input.invoiceMonth as MonthKey,
					)
				: null;
			if (originalId === null) {
				bump(result.skipped, "refund_without_original");
				continue;
			}
			const res = await transactions.upsertByExternal(PLUGGY_SOURCE, mapped.externalId, {
				...mapped.input,
				refundOfId: originalId,
			});
			if (res.created) result.created += 1;
			else result.existing += 1;
		} catch (e) {
			// Um lançamento ruim não derruba os outros. O motivo detalhado não vai para o banco.
			if (e instanceof DataError || e instanceof RangeError) result.failed += 1;
			else throw e;
		}
	}
}

/** `null` se o mapeamento lançou (data de fatura impossível, por exemplo): conta como lançamento que falhou. */
function safeMap(tx: PluggyTransaction, ctx: TransactionContext) {
	try {
		return mapPluggyTransaction(tx, ctx);
	} catch (e) {
		if (e instanceof RangeError) return null;
		throw e;
	}
}

/**
 * A compra que um estorno desfaz: mesma fatura ou até 3 anteriores, mesmo valor e mesma descrição, de data
 * igual ou anterior ao estorno e ainda sem estorno. Na dúvida entre várias, a mais recente.
 */
async function findRefundOriginal(
	transactions: SyncPluggyDeps["stores"]["transactions"],
	card: { id: string },
	original: { amountCents: number; description: string; date: string },
	refundInvoice: MonthKey,
): Promise<string | null> {
	const rows = [];
	for (let back = 0; back <= REFUND_LOOKBACK_MONTHS; back++) {
		rows.push(...(await transactions.listByInvoice(card.id, addMonths(refundInvoice, -back))));
	}
	const refunded = new Set(rows.filter((r) => r.kind === "refund").map((r) => r.refundOfId));
	const wanted = plain(original.description);
	const candidates = rows
		.filter(
			(r) =>
				r.kind === "expense" &&
				r.amountCents === original.amountCents &&
				r.date <= original.date &&
				plain(r.description) === wanted &&
				!refunded.has(r.id),
		)
		.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
	return candidates[0]?.id ?? null;
}
