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
import { hasMeuPluggyPrefix } from "./bank-name.ts";
import { buildCategoryIndex, type CategoryIndex } from "./classify.ts";
import { createPluggyClient, type PluggyClient, type PluggyFetch } from "./client.ts";
import { chooseConnectionLabel } from "./connection-label.ts";
import { PluggyError, safeErrorMessage } from "./errors.ts";
import {
	assignBillPayments,
	type BillPayment,
	type BillTotal,
	isEstimatedCardDates,
	mapPluggyAccount,
	mapPluggyTransaction,
	type PaymentCandidate,
	PLUGGY_SOURCE,
	pluggyDateToLocal,
	type SkipReason,
	type TransactionContext,
	transactionFacts,
} from "./mapping.ts";
import type { PluggyAccount, PluggyBill, PluggyTransaction } from "./schemas.ts";

export const PLUGGY_SYNC_QUEUE = "sincronizacao";
/** Job agendado (todo dia, 06:00 em São Paulo). */
export const PLUGGY_DAILY_JOB = "pluggy-diario";
/** Job pedido pelo app. O id fixo faz pedidos repetidos virarem um só enquanto um está na fila. */
export const PLUGGY_MANUAL_JOB = "pluggy-agora";
export const PLUGGY_MANUAL_JOB_ID = "pluggy-agora";

/** Primeira sincronização de uma conexão: quantos dias para trás. */
export const FIRST_SYNC_DAYS = 90;
/**
 * Depois: recomeça tantos dias antes da última sincronização boa. Lançamento de cartão pode levar semanas para
 * efetivar (aparece na fatura com a data da compra); a gravação é idempotente, então a folga só custa uma consulta maior.
 */
export const OVERLAP_DAYS = 40;
/** Estorno procura a compra original nas faturas dos últimos N meses. */
const REFUND_LOOKBACK_MONTHS = 3;

export interface SyncPluggyDeps {
	stores: Pick<Stores, "accounts" | "cards" | "categories" | "transactions" | "pluggyConnections">;
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
	/** Contas e cartões (não arquivados) ligados à conexão; ausente se a sincronização parou antes de ligar. */
	counts?: { accounts: number; cards: number };
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
 * - Janela: primeira vez, 90 dias; depois, desde `lastSyncAt` menos 40 dias. `lastSyncAt` só avança quando a
 *   conexão termina `ok` (um `partial` repete a janela na próxima). Item que não está `UPDATED`, falha em /bills e
 *   conta que não sincronizou deixam a conexão `partial`.
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
	const lookups = createLookups(deps, client);
	const results: ConnectionSyncResult[] = [];
	for (const connection of connections) {
		const result = await syncConnection(deps, client, connection, startedAt, lookups);
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

/** Categorias que valem para a rodada inteira: buscadas uma vez, só se algum lançamento chegar a precisar delas. */
interface Lookups {
	/** A árvore do Pluggy; `null` se não carregou (vale o nome da categoria do lançamento). */
	categoryIndex(): Promise<CategoryIndex | null>;
	/** slug → id das categorias do Órbita (cria as padrão que faltam; as arquivadas não entram). */
	categoryIds(): Promise<Map<string, string>>;
}

function createLookups(deps: SyncPluggyDeps, client: PluggyClient): Lookups {
	let index: Promise<CategoryIndex | null> | undefined;
	let ids: Promise<Map<string, string>> | undefined;
	return {
		categoryIndex() {
			index ??= client.categories().then(
				(list) => buildCategoryIndex(list),
				(e) => {
					// Chave ruim ou limite: a conexão acusa o erro como em qualquer chamada. O resto não impede a rodada.
					if (e instanceof PluggyError && (e.code === "auth" || e.code === "rate_limit")) throw e;
					return null;
				},
			);
			return index;
		},
		categoryIds() {
			ids ??= (async () => {
				await deps.stores.categories.ensureDefaults();
				return new Map((await deps.stores.categories.list()).map((c) => [c.slug, c.id]));
			})();
			return ids;
		},
	};
}

/** Resultado de `/bills` de um cartão: as faturas, ou `failed` se o Pluggy falhou de verdade (404/403 = sem faturas). */
interface BillsOf {
	bills: PluggyBill[];
	failed: boolean;
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
		...(result.counts ? { counts: result.counts } : {}),
	});
	return result;
}

async function syncConnection(
	deps: SyncPluggyDeps,
	client: PluggyClient,
	connection: PluggyConnectionRecord,
	startedAt: Date,
	lookups: Lookups,
): Promise<ConnectionSyncResult> {
	const result = blank(connection.id, "ok", null);
	// Motivos para a conexão terminar `partial`: não avança `lastSyncAt`, então a próxima rodada refaz a janela.
	const partial: string[] = [];
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
		// O Pluggy só tem o dado novo quando o item está atualizado. Com o banco atrasado (UPDATING, OUTDATED…) o
		// lançamento que ainda vai efetivar não veio; por isso a janela não avança.
		if (item.status !== "UPDATED") {
			result.notes.push("O banco não atualizou os dados no Pluggy ainda.");
			partial.push("o banco não atualizou os dados no Pluggy ainda");
		}
		const pluggyAccounts = await client.accounts(connection.id);
		// Faturas de cada cartão, antes de ligar: elas dão o fechamento e o vencimento quando o `creditData` não traz.
		// Conector sem faturas (404/403) vale como "sem faturas". Falha de verdade impede classificar os débitos e
		// créditos que poderiam ser pagamento (o upsert nunca corrige depois): ficam de fora e a conexão fica `partial`.
		const billsOf = new Map<string, BillsOf>();
		for (const pa of pluggyAccounts) {
			if (pa.type !== "CREDIT") continue;
			try {
				billsOf.set(pa.id, { bills: await client.bills(pa.id), failed: false });
			} catch (e) {
				if (!(e instanceof PluggyError)) throw e;
				if (e.code === "auth" || e.code === "rate_limit") throw e;
				billsOf.set(pa.id, { bills: [], failed: e.code !== "not_found" && e.code !== "forbidden" });
			}
		}
		const { linked, deferredCards } = await linkAccounts(
			deps,
			pluggyAccounts,
			item.connector?.name,
			billsOf,
			result,
		);
		if (deferredCards > 0) partial.push(`${deferredCards} cartão(ões) esperam as faturas para ter as datas`);
		result.counts = {
			accounts: linked.filter((l) => l.account !== null && l.account.archivedAt === null).length,
			cards: linked.filter((l) => l.card !== null && l.card.archivedAt === null).length,
		};
		try {
			await suggestLabel(deps, connection, item.connector?.name, pluggyAccounts);
		} catch {
			// O nome é só conforto: falhar aqui não pode derrubar a sincronização. Sem detalhe (pode vir do banco).
			result.notes.push("Não deu para sugerir o nome da conexão agora.");
		}
		const liveCards = linked.filter((l) => l.card !== null && l.card.archivedAt === null);

		// Pagamentos (casam débito da conta com cartão), totais (plano B) e mês de cada fatura.
		const billPayments: BillPayment[] = [];
		const billTotals: BillTotal[] = [];
		const billMonths = new Map<string, string>();
		let billsUnavailable = false;
		for (const target of liveCards) {
			const cardId = target.card?.id as string;
			const fetchedBills = billsOf.get(target.pluggyId);
			if (fetchedBills?.failed) billsUnavailable = true;
			for (const bill of fetchedBills?.bills ?? []) {
				const due = bill.dueDate ? pluggyDateToLocal(bill.dueDate) : null;
				if (due !== null) billMonths.set(bill.id, due.slice(0, 7));
				const total = centsOrNull(bill.totalAmount);
				if (total !== null) billTotals.push({ cardId, amountCents: total });
				for (const p of bill.payments) {
					const date = pluggyDateToLocal(p.paymentDate);
					const amountCents = centsOrNull(p.amount);
					if (date === null || amountCents === null || (p.currencyCode && p.currencyCode !== "BRL")) continue;
					billPayments.push({ cardId, amountCents, date });
				}
			}
		}
		if (billsUnavailable) {
			result.notes.push(
				"As faturas do cartão não carregaram: débitos e créditos que podem ser pagamento de fatura ficaram de fora.",
			);
			partial.push("as faturas do cartão não carregaram");
		}

		const categoryIndex = (await lookups.categoryIndex()) ?? undefined;
		if (!categoryIndex) {
			result.notes.push(
				"As categorias do Pluggy não carregaram: usei só o nome da categoria de cada lançamento.",
			);
		}
		const categoryIds = await lookups.categoryIds();

		// 1) Baixa os lançamentos de todas as contas.
		const fetched: Array<{ target: Linked; txs: PluggyTransaction[] }> = [];
		let failedAccounts = 0;
		let dropped = 0;
		for (const target of linked) {
			if ((target.account ?? target.card)?.archivedAt) {
				bump(result.skipped, "archived_account");
				continue;
			}
			try {
				const res = await client.transactions({ accountId: target.pluggyId, from, to: today });
				dropped += res.dropped;
				fetched.push({ target, txs: res.transactions });
			} catch (e) {
				if (e instanceof PluggyError && (e.code === "auth" || e.code === "rate_limit")) throw e;
				failedAccounts += 1;
				result.notes.push(`Uma conta não sincronizou: ${safeErrorMessage(e)}`);
			}
		}
		if (dropped > 0)
			result.notes.push(`${dropped} lançamento(s) vieram fora do formato e foram descartados.`);

		// 2) Casa cada pagamento de fatura com UM lançamento. O pool do banco é da conexão inteira (o pagamento pode
		// sair de qualquer conta); o do cartão é por cartão.
		const matches = new Map<string, BillPayment>();
		const bankPool: PaymentCandidate[] = [];
		for (const { target, txs } of fetched) {
			const pool = txs.flatMap((tx) => {
				if (tx.status === "PENDING") return [];
				const facts = transactionFacts(tx);
				if (!facts || tx.type !== (target.card ? "CREDIT" : "DEBIT")) return [];
				return [{ id: tx.id, ...facts }];
			});
			if (target.card) {
				const cardId = target.card.id;
				const mine = billPayments.filter((p) => p.cardId === cardId);
				for (const [id, payment] of assignBillPayments(pool, mine)) matches.set(id, payment);
			} else {
				bankPool.push(...pool);
			}
		}
		for (const [id, payment] of assignBillPayments(bankPool, billPayments)) matches.set(id, payment);

		// 3) Grava.
		for (const { target, txs } of fetched) {
			const ctx: TransactionContext = {
				accountType: target.account ? "BANK" : "CREDIT",
				accountId: target.account?.id ?? null,
				card: target.card ? { id: target.card.id, config: toCardConfig(target.card) } : null,
				ownerTaxNumber: target.taxNumber,
				billPaymentMatches: matches,
				billTotals,
				billMonths,
				billsUnavailable,
				...(categoryIndex ? { categoryIndex } : {}),
				categoryIds,
			};
			await storeTransactions(deps, txs, ctx, result);
		}
		const investments = result.skipped.investment ?? 0;
		if (investments > 0) {
			result.notes.push(
				`${investments} movimento(s) de investimento (aplicação, resgate, caixinha) ficaram de fora: não são gasto nem receita.`,
			);
		}
		const unlinked = result.skipped.card_payment_unlinked ?? 0;
		if (unlinked > 0) {
			result.notes.push(
				`${unlinked} pagamento(s) de fatura não foram ligados a um cartão e ficaram de fora (o valor não bate com nenhuma fatura).`,
			);
		}

		if (failedAccounts > 0) partial.push(`${failedAccounts} conta(s) não sincronizaram`);
		if (result.failed > 0) partial.push(`${result.failed} lançamento(s) não puderam ser gravados`);
		if (partial.length > 0) {
			result.status = "partial";
			result.error = `${capitalize(partial.join("; "))}. Na próxima sincronização o Órbita tenta de novo.`;
		}
		return result;
	} catch (e) {
		result.status = "error";
		result.error = safeErrorMessage(e);
		return result;
	}
}

/** Nome da conexão a partir das contas dela, se o dono não deu um. Falha aqui nunca derruba a sincronização. */
async function suggestLabel(
	deps: SyncPluggyDeps,
	connection: PluggyConnectionRecord,
	connectorName: string | null | undefined,
	pluggyAccounts: readonly PluggyAccount[],
): Promise<void> {
	// Relê a conexão: o dono pode ter renomeado desde o início da rodada.
	const current = (await deps.stores.pluggyConnections.get(connection.id)) ?? connection;
	const label = chooseConnectionLabel({
		current: current.label,
		connectorName,
		editedByOwner: current.labelEditedByOwner,
		accounts: pluggyAccounts,
	});
	if (label !== null) await deps.stores.pluggyConnections.setAutoLabel(connection.id, label);
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Centavos positivos de um valor do Pluggy, ou `null` se zero/fora do que o Órbita aceita. */
function centsOrNull(value: number | string | null | undefined): number | null {
	if (value === null || value === undefined) return null;
	try {
		const cents = Math.abs(decimalToCents(value));
		return cents > 0 ? cents : null;
	} catch {
		return null;
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
	billsOf: ReadonlyMap<string, BillsOf>,
	result: ConnectionSyncResult,
): Promise<{ linked: Linked[]; deferredCards: number }> {
	const { accounts, cards } = deps.stores;
	const out: Linked[] = [];
	let deferredCards = 0;
	for (const pa of pluggyAccounts) {
		const mapped = mapPluggyAccount(pa, connectorName, billsOf.get(pa.id)?.bills);
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
			} else if (account.archivedAt === null && hasMeuPluggyPrefix(account.name)) {
				// Importada antes da limpeza do nome ("MeuPluggy Inter"): o prefixo é a marca de que o dono ainda não
				// mexeu no nome, então troca uma vez; depois do nome novo isto não roda de novo.
				account = await accounts.update(account.id, { name: mapped.input.name });
			}
			out.push({ pluggyId: pa.id, taxNumber: pa.taxNumber ?? null, account, card: null });
			continue;
		}
		let card = await cards.findByExternal(PLUGGY_SOURCE, mapped.externalId);
		if (!card) {
			// As faturas falharam e o `creditData` não tem as datas: criar agora fixaria dias inventados (o sync nunca
			// os corrige depois). Espera a próxima rodada, que já volta `partial`.
			if (billsOf.get(pa.id)?.failed && isEstimatedCardDates(mapped.dates.origin)) {
				deferredCards += 1;
				result.notes.push(
					`O cartão "${mapped.input.name}" ainda não foi criado: as faturas não carregaram e sem elas as datas seriam chute.`,
				);
				continue;
			}
			if (isEstimatedCardDates(mapped.dates.origin)) {
				result.notes.push(
					mapped.dates.origin === "due_date_only"
						? `Cartão "${mapped.input.name}": o Pluggy só informou o vencimento (dia ${mapped.dates.dueDay}); o fechamento (dia ${mapped.dates.closingDay}) é estimado em 7 dias antes. Confira em Cartões.`
						: `Cartão "${mapped.input.name}": o Pluggy não informou fechamento nem vencimento; usei dia ${mapped.dates.closingDay} e dia ${mapped.dates.dueDay} (datas estimadas). Ajuste em Cartões.`,
				);
			}
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
		if (card && card.archivedAt === null && hasMeuPluggyPrefix(card.name)) {
			card = await cards.update(card.id, { name: mapped.input.name });
		}
		out.push({ pluggyId: pa.id, taxNumber: pa.taxNumber ?? null, account: null, card });
	}
	return { linked: out, deferredCards };
}

const bump = (counts: ConnectionSyncResult["skipped"], key: SkipReason | "archived_account") => {
	counts[key] = (counts[key] ?? 0) + 1;
};

async function storeTransactions(
	deps: SyncPluggyDeps,
	txs: readonly PluggyTransaction[],
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
