import {
	addDays,
	addMonths,
	type CardConfig,
	decimalToCents,
	invoiceByMonth,
	invoiceStatus,
	type LocalDate,
	type MonthKey,
	paymentWindow,
	toLocalDate,
} from "@orbita/core";
import {
	type AccountRecord,
	type CardRecord,
	DataError,
	type PluggyConnectionRecord,
	type Stores,
	type TransactionPatch,
	type TransactionRecord,
	toCardConfig,
	type UpsertByExternalInput,
} from "@orbita/db";
import {
	PLUGGY_FIRST_SYNC_DAYS,
	PLUGGY_NO_ACCOUNTS_PREFIX,
	PLUGGY_NO_DATA_PREFIX,
	PLUGGY_ONLY_INVESTMENTS_PREFIX,
	PLUGGY_RECONNECT_MESSAGE,
	PLUGGY_UNREAD_PRODUCTS_PREFIX,
	PLUGGY_UPDATING_PREFIX,
	type PluggySyncStatus,
	type SecretName,
} from "@orbita/shared";
import { flagUnconfirmedNotifications } from "../notification/reconcile.ts";
import { sameBankAccountIds } from "../notification/same-bank.ts";
import { type BankNumbersResult, recordBankNumbers, recordBills } from "./balances.ts";
import {
	detectBankName,
	findKnownBank,
	hasMeuPluggyPrefix,
	isLegacyRawName,
	isMeuPluggyConnector,
	isWeakCardName,
} from "./bank-name.ts";
import {
	buildCategoryIndex,
	type CategoryIndex,
	isCardChargeOperation,
	operationSignal,
} from "./classify.ts";
import { createPluggyClient, type PluggyClient, type PluggyFetch } from "./client.ts";
import { inferClosingRule } from "./closing-rule.ts";
import { chooseConnectionLabel, issuerHints } from "./connection-label.ts";
import {
	isPaymentNote,
	type OwnTransferLeg,
	pairOwnTransfers,
	RECOMPUTED_TRANSFER_NOTE,
	reconcileAcrossConnections,
} from "./cross.ts";
import { adoptEarlyEntry, POSSIBLE_DUPLICATE_NOTE } from "./early.ts";
import { PluggyError, safeErrorMessage } from "./errors.ts";
import { readInvestments } from "./investments.ts";
import {
	assignBillPayments,
	type BillInfo,
	type BillPayment,
	type BillTotal,
	isEstimatedCardDates,
	isGeneratedAccountName,
	type MappedAccount,
	type MappedTransaction,
	mapPluggyAccount,
	mapPluggyTransaction,
	PAYMENT_REVIEW_NOTE,
	PAYMENT_UNCONNECTED_NOTE,
	type PaymentCandidate,
	PLUGGY_SOURCE,
	pluggyDateToLocal,
	type SkipReason,
	shouldRecategorizeDigital,
	shouldUpgradeCategory,
	type TransactionContext,
	touchedByOwner,
	transactionFacts,
} from "./mapping.ts";
import { type BatchPeer, reconcileRecreated, reviewVanished } from "./recreated.ts";
import {
	createRelinkGuard,
	pickRelinkAccount,
	pickRelinkCard,
	type RelinkGuard,
	rekeyRelinked,
	relinkKey,
} from "./relink.ts";
import { categorizeSalaryCredits } from "./salary.ts";
import type { PluggyAccount, PluggyBill, PluggyItem, PluggyTransaction } from "./schemas.ts";

export { type OwnTransferLeg, pairOwnTransfers };

export const PLUGGY_SYNC_QUEUE = "sincronizacao";
/** Job agendado (todo dia, 06:00 em São Paulo). */
export const PLUGGY_DAILY_JOB = "pluggy-diario";
/** Job pedido pelo app. O id fixo faz pedidos repetidos virarem um só enquanto um está na fila. */
export const PLUGGY_MANUAL_JOB = "pluggy-agora";
export const PLUGGY_MANUAL_JOB_ID = "pluggy-agora";
/** Nova tentativa que o próprio worker agenda quando uma conexão ainda espera o banco (ver `ConnectionSyncResult.retry`). */
export const PLUGGY_RETRY_JOB = "pluggy-de-novo";

/**
 * Quantos dias para trás a primeira sincronização de uma conexão olha: 6 meses (e o backfill único das conexões
 * que nunca buscaram tanto: ver `syncWindowStart`).
 */
export const FIRST_SYNC_DAYS = PLUGGY_FIRST_SYNC_DAYS;
/** Nas rodadas seguintes, a janela nunca é menor que 4 meses (parcelas e faturas anteriores). */
export const ROUTINE_SYNC_DAYS = 122;
/**
 * Depois: recomeça tantos dias antes da última sincronização boa. Lançamento de cartão pode levar semanas para
 * efetivar (aparece na fatura com a data da compra); a gravação é idempotente, então a folga só custa uma consulta maior.
 */
export const OVERLAP_DAYS = 40;
/** Estorno procura a compra original nas faturas dos últimos N meses. */
const REFUND_LOOKBACK_MONTHS = 3;

export interface SyncPluggyDeps {
	stores: Pick<
		Stores,
		"accounts" | "cards" | "bills" | "categories" | "categoryRules" | "transactions" | "pluggyConnections"
	> &
		Partial<Pick<Stores, "incomeSources">>;
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
	/** O que a rodada gravou do que o banco informa: saldos, limites disponíveis e faturas (só quando gravou algo). */
	bankNumbers?: BankNumbersResult;
	created: number;
	existing: number;
	failed: number;
	/** Lançamentos antigos corrigidos nesta rodada (receita gravada como despesa, transferência própria que contava como gasto). */
	reclassified?: number;
	/** Lançamentos do dono (manual, chat, extrato) que o Pluggy trouxe depois e passaram a ser o mesmo registro. */
	adopted?: number;
	/** Lançamentos do Pluggy gravados para revisão porque mais de um lançamento do dono servia (possível duplicata). */
	possibleDuplicates?: number;
	/** Contas e cartões de uma conexão antiga do mesmo banco religados ao item novo (ids novos, sem duplicar). */
	relinkedAccounts?: number;
	/** Lançamentos já gravados pelo item antigo que passaram a ter o id do item novo (nada duplicou). */
	rekeyed?: number;
	/** `connector.isOpenFinance` do item (só nele vêm providerId, billId e o operationType do Open Finance). */
	isOpenFinance?: boolean;
	/** Compras PENDING da fatura aberta do cartão gravadas agora como despesa "pendente no banco". */
	pendingStored?: number;
	/** Pendentes que o banco efetivou (POSTED) e foram atualizadas no lugar, sem duplicar. */
	settled?: number;
	/** Lançamentos que o banco apagou e recriou com id novo e que foram religados ao que já existia (nada duplicou). */
	recreated?: number;
	/** Lançamentos "removidos pelo banco" que o banco trouxe de volta com o mesmo id. */
	restored?: number;
	/** Lançamentos que o banco parou de informar e foram apagados ("removido pelo banco"). */
	removedByBank?: number;
	/** O mesmo, mas editados pelo dono: não foram apagados, só marcados para revisão. */
	flaggedMissing?: number;
	skipped: Partial<Record<SkipReason | "archived_account", number>>;
	/**
	 * A conexão ainda espera o banco e vale tentar de novo sem o dono pedir: o item está `UPDATING`, ou a conexão é
	 * nova e ainda não trouxe conta. `notBefore`: quando o Pluggy diz que atualiza o item (`nextAutoSyncAt`).
	 */
	retry?: { reason: "updating" | "no_accounts" | "no_data"; notBefore?: string };
	/** O dia de onde a janela desta rodada buscou (vai para `historyFrom` se terminar `ok`). Uso interno do sync. */
	windowFrom?: string;
	/**
	 * `partial` cujo único motivo é conta recusada por formato, com todas as aceitas sincronizadas: repetir a janela
	 * não ajuda, então ela avança como numa rodada `ok` (a conta recusada continua avisada a cada rodada).
	 */
	windowDone?: boolean;
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
 * - Janela: primeira vez (ou backfill único, `historyFrom`) 6 meses (`FIRST_SYNC_DAYS`); depois pelo menos 4 meses (`ROUTINE_SYNC_DAYS`); se a última sincronização boa é mais antiga, desde ela
 *   menos 40 dias. `lastSyncAt` só avança quando a
 *   conexão termina `ok` (um `partial` repete a janela na próxima). Item que não está `UPDATED`, falha em /bills e
 *   conta que não sincronizou deixam a conexão `partial`.
 * - Sem chaves: grava "no_keys" em cada conexão e sai, sem erro e sem chamar o Pluggy.
 * - O que o Pluggy trouxe é `confirmed`. Compra `PENDING` do CARTÃO (fatura aberta) entra como despesa com `bankPending`
 *   e é atualizada no lugar quando vira `POSTED` (mesmo id; id novo é religado por `providerId`/`providerCode`/atributos:
 *   `recreated.ts`). `PENDING` na CONTA (agendado, em processamento) fica de fora até efetivar. O que o banco deixa de
 *   informar por dias é removido ("removido pelo banco"), menos o que o dono editou (vai para revisão). Fontes na doc
 *   da Pluggy em docs/pluggy.md ("Pendentes, apagados e recriados").
 * - Nunca lança por causa de uma conexão: o erro vira o `lastError` (já sanitizado) daquela conexão.
 */
export async function syncPluggy(
	deps: SyncPluggyDeps,
	/**
	 * `connectionIds`: sincroniza só estas conexões (a nova tentativa das que esperam o banco); ausente = todas.
	 * Lista que não casa com nenhuma conexão cadastrada dá `no_connections`.
	 */
	options: { connectionIds?: readonly string[] } = {},
): Promise<SyncPluggyResult> {
	const { stores, now } = deps;
	const log = deps.log ?? (() => {});
	const only = options.connectionIds
		? new Set(options.connectionIds.map((id) => id.trim().toLowerCase()))
		: null;
	// A lista completa é o que `createRelinkGuard` precisa para saber das outras conexões vivas; só o laço de
	// sincronização é filtrado por `connectionIds`.
	const everyConnection = await stores.pluggyConnections.list();
	const connections = everyConnection.filter((c) => only === null || only.has(c.id));
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
	const shared: RunShared = { owners: new Map(), cards: [], bills: [], payments: [] };
	for (const connection of connections) {
		const guard = createRelinkGuard(client, connection, everyConnection);
		const result = await syncConnection(deps, client, connection, startedAt, lookups, shared, guard);
		results.push(
			await finish(
				deps,
				connection,
				result,
				startedAt,
				result.windowFrom ?? syncWindowStart(toLocalDate(startedAt), connection),
			),
		);
		log(
			`pluggy: ${result.status} contas=${result.accounts} novos=${result.created} existentes=${result.existing}`,
		);
	}
	// Numa nova tentativa só de parte das conexões, os cartões e faturas das outras vêm do que já está gravado (sem
	// chamar o Pluggy): o pagamento de fatura de um banco para o cartão de outro liga como no sync completo.
	await crossConnections(
		deps,
		only === null ? shared : await withStoredCards(deps, shared),
		startedAt,
		results,
	);
	await labelSalary(deps, startedAt, log);
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

/** Rotula o salário entre as entradas (pagador recorrente ou renda cadastrada). Só conforto: nunca derruba a rodada. */
async function labelSalary(
	deps: SyncPluggyDeps,
	startedAt: Date,
	log: (line: string) => void,
): Promise<void> {
	if (!deps.stores.incomeSources) return;
	try {
		await deps.stores.categories.ensureDefaults();
		const labeled = await categorizeSalaryCredits(
			{
				transactions: deps.stores.transactions,
				categories: deps.stores.categories,
				incomeSources: deps.stores.incomeSources,
			},
			toLocalDate(startedAt),
		);
		if (labeled > 0) log(`pluggy: salário reconhecido em ${labeled} entrada(s)`);
	} catch {
		log("pluggy: não deu para reconhecer o salário agora");
	}
}

/** O que as conexões já sincronizadas desta rodada sabem dos cartões e das faturas (para as conexões seguintes e o passo final). */
interface RunShared {
	/** Titular de cada conta (id da conta do Órbita → `owner` do Pluggy), para o sinal de titularidade do passo final. */
	owners: Map<string, string | null>;
	cards: { id: string; name: string; last4: string | null }[];
	bills: BillInfo[];
	/** `payments[]` das faturas de todas as conexões vistas. */
	payments: BillPayment[];
}

/**
 * Completa o que a rodada viu com os cartões, faturas e pagamentos de fatura JÁ GRAVADOS dos cartões que a rodada não
 * leu (os das conexões fora de `connectionIds`). Não inclui o que não é gravado: o titular das contas (`owner`) e a
 * fatura aberta sintética (soma das compras PENDING), que só existem na rodada que lê o Pluggy; o sync completo diário
 * os recoloca.
 */
async function withStoredCards(deps: SyncPluggyDeps, shared: RunShared): Promise<RunShared> {
	const seen = new Set(shared.cards.map((c) => c.id));
	const cards = [...shared.cards];
	const bills = [...shared.bills];
	const payments = [...shared.payments];
	try {
		for (const card of await deps.stores.cards.list()) {
			if (seen.has(card.id) || card.archivedAt !== null || card.source !== PLUGGY_SOURCE) continue;
			cards.push({ id: card.id, name: card.name, last4: card.last4 });
			for (const bill of await deps.stores.bills.listByCard(card.id)) {
				const paid = bill.payments.reduce((sum, p) => sum + p.amountCents, 0);
				bills.push({
					cardId: card.id,
					totalCents: bill.totalAmountCents,
					remainingCents: Math.max(bill.totalAmountCents - paid, 0),
					dueDate: bill.dueDate,
				});
				for (const p of bill.payments) {
					payments.push({ cardId: card.id, amountCents: p.amountCents, date: p.date });
				}
			}
		}
	} catch {
		// Sem os gravados, vale o que a rodada viu (o sync completo corrige depois).
		return shared;
	}
	return { owners: shared.owners, cards, bills, payments };
}

/** Passo final, com todas as conexões já gravadas: pagamento de fatura e transferência entre contas de conexões diferentes. */
async function crossConnections(
	deps: SyncPluggyDeps,
	shared: RunShared,
	startedAt: Date,
	results: ConnectionSyncResult[],
): Promise<void> {
	const target = results.find((r) => r.status !== "error") ?? null;
	if (target === null) return;
	try {
		const done = await reconcileAcrossConnections({
			transactions: deps.stores.transactions,
			today: toLocalDate(startedAt),
			cards: shared.cards,
			bills: shared.bills,
			payments: shared.payments,
			owners: new Map(shared.owners),
		});
		const n = done.billPayments + done.ownTransfers;
		if (n > 0) {
			target.reclassified = (target.reclassified ?? 0) + n;
			target.notes.push(
				`${n} lançamento(s) foram corrigidos olhando todas as conexões (pagamento de fatura de outro banco, transferência entre contas suas).`,
			);
		}
	} catch (e) {
		if (e instanceof PluggyError && (e.code === "auth" || e.code === "rate_limit")) throw e;
		target.notes.push("Não deu para conferir as transferências e faturas entre conexões agora.");
	}
}

/** Categorias que valem para a rodada inteira: buscadas uma vez, só se algum lançamento chegar a precisar delas. */
interface Lookups {
	/** A árvore do Pluggy; `null` se não carregou (vale o nome da categoria do lançamento). */
	categoryIndex(): Promise<CategoryIndex | null>;
	/** slug → id das categorias do Órbita (cria as padrão que faltam; as arquivadas não entram). */
	categoryIds(): Promise<Map<string, string>>;
	/** Regras do dono, lidas uma vez por rodada. */
	categoryRules(): Promise<readonly { pattern: string; categoryId: string }[]>;
}

function createLookups(deps: SyncPluggyDeps, client: PluggyClient): Lookups {
	let index: Promise<CategoryIndex | null> | undefined;
	let ids: Promise<Map<string, string>> | undefined;
	let rules: Promise<readonly { pattern: string; categoryId: string }[]> | undefined;
	return {
		categoryRules() {
			rules ??= deps.stores.categoryRules.list();
			return rules;
		},
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
	/** Dia de onde a janela desta rodada buscou; vai para `historyFrom` quando a conexão termina `ok`. */
	from?: string,
): Promise<ConnectionSyncResult> {
	await deps.stores.pluggyConnections.recordSync(connection.id, {
		status: result.status,
		error: result.error,
		...((result.status === "ok" || (result.status === "partial" && result.windowDone)) && startedAt
			? {
					syncedAt: startedAt,
					...(from ? { historyFrom: from } : {}),
					...(result.status === "partial" ? { windowDone: true } : {}),
				}
			: {}),
		...(result.counts ? { counts: result.counts } : {}),
		...(typeof result.isOpenFinance === "boolean" ? { isOpenFinance: result.isOpenFinance } : {}),
	});
	return result;
}

async function syncConnection(
	deps: SyncPluggyDeps,
	client: PluggyClient,
	connection: PluggyConnectionRecord,
	startedAt: Date,
	lookups: Lookups,
	shared: RunShared,
	guard: RelinkGuard,
): Promise<ConnectionSyncResult> {
	const result = blank(connection.id, "ok", null);
	// Motivos para a conexão terminar `partial`: não avança `lastSyncAt`, então a próxima rodada refaz a janela.
	const partial: string[] = [];
	// Dos motivos acima, os que são só linha recusada por formato (repetir a janela não os resolve).
	const formatOnly = new Set<string>();
	// Começo do `lastError` que o app reconhece ("Atualizando no banco…", "ainda não enviou contas").
	let lead: string | null = null;
	// O motivo em `partial` que o `lead` já diz; os outros viram " · e mais N avisos" no `lastError`.
	let leadReason: string | null = null;
	let unreadProducts = false;
	// Só investimentos por enquanto, numa conexão nova: o `lastError` diz isso e o app mostra o mesmo estado.
	let onlyInvestmentsWaiting = false;
	try {
		const today = toLocalDate(startedAt);
		let from = syncWindowStart(today, connection);

		const item = await client.item(connection.id);
		// `connector.isOpenFinance` (docs.pluggy.ai/reference/items-retrieve): onde `providerId`, `billId`,
		// `billForecastDate` e o `operationType` do Open Finance podem vir. Guardado na conexão.
		if (typeof item.connector?.isOpenFinance === "boolean")
			result.isOpenFinance = item.connector.isOpenFinance;
		if (NEEDS_USER.has(item.status)) {
			result.status = "error";
			result.error = PLUGGY_RECONNECT_MESSAGE;
			return result;
		}
		// O Pluggy só tem o dado novo quando o item está atualizado. Com o banco atrasado (UPDATING, OUTDATED…) o
		// lançamento que ainda vai efetivar não veio; por isso a janela não avança.
		const notBefore = retryNotBefore(item.nextAutoSyncAt, startedAt);
		if (item.status === "UPDATING") {
			// Em andamento ("An update process is in progress and will be updated soon": docs.pluggy.ai, Item lifecycle).
			result.notes.push("O banco ainda está atualizando os dados no Pluggy.");
			leadReason = "o banco ainda está atualizando os dados no Pluggy";
			partial.push(leadReason);
			lead = PLUGGY_UPDATING_PREFIX;
			result.retry = { reason: "updating", ...(notBefore ? { notBefore } : {}) };
		} else if (item.status !== "UPDATED") {
			const why = itemProblemText(item.executionStatus);
			result.notes.push("O banco não atualizou os dados no Pluggy ainda.");
			if (why !== null) result.notes.push(`O Pluggy informou: ${why}.`);
			partial.push(`o banco não atualizou os dados no Pluggy ainda${why !== null ? ` (${why})` : ""}`);
		}
		// Cada conta é validada sozinha: a que vem fora do formato é contada e avisada, nunca some em silêncio.
		const accountsRead = await client.accountsRead(connection.id);
		const pluggyAccounts = accountsRead.rows;
		if (accountsRead.dropped > 0) {
			result.notes.push(
				`${accountsRead.dropped} conta(s) vieram do Pluggy fora do formato e não foram importadas (${accountsRead.problems.join("; ") || "sem detalhe"}). Mande o Diagnóstico da conexão para corrigir.`,
			);
			const reason = `${accountsRead.dropped} conta(s) vieram fora do formato`;
			partial.push(reason);
			formatOnly.add(reason);
		}
		// Campo opcional que veio com tipo errado ou comprido demais não recusa a conta, mas não passa em silêncio.
		const fieldProblems = new Set(pluggyAccounts.flatMap((a) => a.fieldProblems ?? []));
		if (fieldProblems.size > 0) {
			result.notes.push(
				`Alguns campos das contas vieram fora do formato e foram ignorados ou cortados (${[...fieldProblems].slice(0, 6).join("; ")}). Mande o Diagnóstico da conexão se algo ficou errado.`,
			);
		}
		if (
			pluggyAccounts.length === 0 &&
			accountsRead.dropped === 0 &&
			consentExpired(item.consentExpiresAt, startedAt)
		) {
			// "Reads stop": com a autorização vencida as listas voltam vazias e o item ainda diz UPDATED até a próxima
			// atualização (docs.pluggy.ai/docs/guides/meu-pluggy-personal-use). Só o dono renova, entrando de novo.
			result.status = "error";
			result.error = PLUGGY_RECONNECT_MESSAGE;
			// Nova tentativa não resolve (o item pode estar `UPDATING` aqui): só o dono renova a autorização.
			delete result.retry;
			return result;
		}
		// Sem nenhuma linha em /accounts de uma conexão que NUNCA teve conta nem cartão: o que sobra de pista (nome e
		// estado) são os investimentos. Só aqui se lê /investments (nunca lança); conexão que já teve conta e veio vazia
		// por falha passageira segue "ainda não enviou contas" (partial).
		let investmentsSeen = 0;
		let investmentIssuers: (string | null | undefined)[] = [];
		if (
			pluggyAccounts.length === 0 &&
			accountsRead.dropped === 0 &&
			connection.accountCount + connection.cardCount === 0
		) {
			const read = await readInvestments(client, connection.id);
			if (read.outcome === "ok") {
				investmentsSeen = read.rows.length;
				// O emissor só dá nome no MeuPluggy (no conector que é o banco o nome já vem do conector).
				if (isMeuPluggyConnector(item.connector?.name)) {
					investmentIssuers = issuerHints(read.rows, read.dropped);
				}
			} else if (read.outcome === "error") {
				result.notes.push("Não consegui ler os investimentos desta vez.");
			}
		}
		// O nome vem só do que já foi lido, antes de bills, ligação das contas e lançamentos: o que falhar depois não o
		// impede de ser refeito. Falhar aqui nunca derruba a sincronização (sem detalhe: pode vir do banco).
		try {
			await suggestLabel(deps, connection, item.connector?.name, pluggyAccounts, investmentIssuers);
		} catch {
			result.notes.push("Não deu para sugerir o nome da conexão agora.");
		}
		// Faturas de cada cartão, antes de ligar: elas dão o fechamento e o vencimento quando o `creditData` não traz.
		// Conector sem faturas (404/403) vale como "sem faturas". Falha de verdade impede classificar os débitos e
		// créditos que poderiam ser pagamento (o upsert nunca corrige depois): ficam de fora e a conexão fica `partial`.
		const billsOf = new Map<string, BillsOf>();
		for (const pa of pluggyAccounts) {
			if (pa.type !== "CREDIT") continue;
			try {
				const billsRead = await client.billsRead(pa.id);
				billsOf.set(pa.id, { bills: billsRead.rows, failed: false });
				if (billsRead.dropped > 0) {
					result.notes.push(
						`${billsRead.dropped} fatura(s) vieram fora do formato e foram descartadas (${billsRead.problems.join("; ") || "sem detalhe"}).`,
					);
				}
			} catch (e) {
				if (!(e instanceof PluggyError)) throw e;
				if (e.code === "auth" || e.code === "rate_limit") throw e;
				billsOf.set(pa.id, { bills: [], failed: e.code !== "not_found" && e.code !== "forbidden" });
			}
		}
		// O MeuPluggy não diz o banco: a pista é o nome das contas da conexão (ou o rótulo dela).
		const bankName = detectBankName({
			connectorName: item.connector?.name,
			accountNames: pluggyAccounts.flatMap((a) => [a.marketingName, a.name]),
			transferNumbers: pluggyAccounts.map((a) => a.bankData?.transferNumber),
			connectionLabel: connection.label,
		});
		const { linked, deferredCards, deferredRelink, relinked } = await linkAccounts(
			deps,
			pluggyAccounts,
			item.connector?.name,
			billsOf,
			result,
			bankName,
			guard,
		);
		// Conexão que ainda não importou lançamento nem fatura nenhum (o espelho do MeuPluggy pode entregar a conta antes
		// dos dados) é nova: a janela é a inicial, mesmo que uma rodada anterior tenha terminado `ok` e gasto `historyFrom`.
		const imported = await hasImportedData(deps, linked);
		from = syncWindowStart(today, connection, imported);
		result.windowFrom = from;
		if (deferredCards > 0) partial.push(`${deferredCards} cartão(ões) esperam as faturas para ter as datas`);
		if (deferredRelink > 0) {
			partial.push(`${deferredRelink} conta(s) esperam a conferência das outras conexões`);
		}
		if (relinked > 0) await retireOldConnections(deps, guard, connection, item.connector, bankName, result);
		// Nenhuma conta nem cartão para importar. O item pode estar `UPDATED`/`SUCCESS` e mesmo assim `GET /accounts`
		// vir vazio (visto numa conexão nova do MeuPluggy): não é "sincronizado", e a janela inicial não pode avançar.
		const empty = result.accounts === 0 && deferredRelink === 0;
		if (empty) {
			const ignored = pluggyAccounts.length;
			if (ignored > 0) {
				result.notes.push(
					`O Pluggy devolveu ${ignored} conta(s), mas nenhuma é conta ou cartão que o Órbita importa.`,
				);
			} else if (accountsRead.dropped === 0) {
				result.notes.push(
					investmentsSeen > 0
						? "O Pluggy não devolveu conta nem cartão, só investimentos."
						: "O Pluggy não devolveu nenhuma conta para esta conexão.",
				);
			}
			for (const note of productWarnings(item.statusDetail)) result.notes.push(note);
			if (ignored === 0 && investmentsSeen > 0) {
				// /accounts vazio, mas há posições em /investments: o banco só enviou produto que o Órbita não lê. Não é
				// "ainda não enviou contas". No MeuPluggy o espelho pode estar sendo preenchido: enquanto a conexão é nova,
				// tenta de novo, com o texto honesto.
				unreadProducts = true;
				const isNew = startedAt.getTime() - connection.createdAt.getTime() < NEW_CONNECTION_MS;
				if (isNew) {
					onlyInvestmentsWaiting = true;
					if (!result.retry) result.retry = { reason: "no_accounts", ...(notBefore ? { notBefore } : {}) };
				}
			} else if (ignored > 0) {
				// O banco enviou linhas, mas todas de produto que o Órbita não lê (investimento…): esperar não muda isso, então
				// sem "ainda não enviou contas", sem nova tentativa e sem falha: é informação (a conexão termina `ok`).
				unreadProducts = true;
			} else {
				partial.push("o banco ainda não enviou contas");
				if (lead === null) {
					lead = PLUGGY_NO_ACCOUNTS_PREFIX;
					leadReason = "o banco ainda não enviou contas";
				}
				// Conexão nova: o item do MeuPluggy espelha o item original e recebe o dado na atualização seguinte dele.
				const isNew = startedAt.getTime() - connection.createdAt.getTime() < NEW_CONNECTION_MS;
				if (isNew && !result.retry)
					result.retry = { reason: "no_accounts", ...(notBefore ? { notBefore } : {}) };
			}
		}
		// Sem conta agora, mas a conexão já teve: as contas continuam no Órbita, a contagem gravada fica.
		if (!(empty && connection.accountCount + connection.cardCount > 0)) {
			result.counts = {
				accounts: linked.filter((l) => l.account !== null && l.account.archivedAt === null).length,
				cards: linked.filter((l) => l.card !== null && l.card.archivedAt === null).length,
			};
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
				if (total !== null) {
					const paid = bill.payments.reduce((sum, p) => sum + (centsOrNull(p.amount) ?? 0), 0);
					shared.bills.push({
						cardId,
						totalCents: total,
						remainingCents: Math.max(total - paid, 0),
						dueDate: due,
					});
				}
				for (const p of bill.payments) {
					const date = pluggyDateToLocal(p.paymentDate);
					const amountCents = centsOrNull(p.amount);
					if (date === null || amountCents === null || (p.currencyCode && p.currencyCode !== "BRL")) continue;
					billPayments.push({ cardId, amountCents, date });
				}
			}
		}
		shared.payments.push(...billPayments);
		await storeBankNumbers(deps, pluggyAccounts, linked, billsOf, result);
		for (const l of linked) {
			if (l.account && l.ownerName) shared.owners.set(l.account.id, l.ownerName);
		}
		for (const l of liveCards) {
			if (l.card && !shared.cards.some((c) => c.id === l.card?.id)) {
				shared.cards.push({ id: l.card.id, name: l.card.name, last4: l.card.last4 });
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
		const categoryRules = await lookups.categoryRules();

		// 1) Baixa os lançamentos de todas as contas.
		const fetched: Array<{ target: Linked; txs: PluggyTransaction[] }> = [];
		let failedAccounts = 0;
		let dropped = 0;
		const droppedWhy = new Set<string>();
		for (const target of linked) {
			if ((target.account ?? target.card)?.archivedAt) {
				bump(result.skipped, "archived_account");
				continue;
			}
			try {
				const res = await client.transactions({ accountId: target.pluggyId, from, to: today });
				dropped += res.dropped;
				for (const problem of res.problems) droppedWhy.add(problem);
				fetched.push({ target, txs: res.transactions });
			} catch (e) {
				if (e instanceof PluggyError && (e.code === "auth" || e.code === "rate_limit")) throw e;
				failedAccounts += 1;
				result.notes.push(`Uma conta não sincronizou: ${safeErrorMessage(e)}`);
			}
		}
		// Regra de fechamento de cada cartão, lida das faturas dele; sem evidência (ou com empate) não muda nada. A que o
		// dono escolheu (`closingRuleSource` "owner") nunca é tocada. A padrão sobe para "included" quando o banco fecha
		// incluindo o dia; a que o sync mesmo deduziu volta ao padrão se a evidência passar a dizer "next".
		const ruleChanged = new Set<string>();
		for (const { target, txs } of fetched) {
			const card = target.card;
			if (!card || card.closingRuleSource === "owner") continue;
			const rule = inferClosingRule(txs, billsOf.get(target.pluggyId)?.bills ?? []);
			if (rule === null || rule === card.closingRule) continue;
			if (rule === "closing-day-included") {
				target.card = await deps.stores.cards.update(card.id, {
					closingRule: rule,
					closingRuleSource: "inferred",
				});
				ruleChanged.add(card.id);
			} else if (card.closingRuleSource === "inferred") {
				target.card = await deps.stores.cards.update(card.id, {
					closingRule: rule,
					closingRuleSource: "default",
				});
				ruleChanged.add(card.id);
			}
		}
		if (dropped > 0)
			result.notes.push(
				`${dropped} lançamento(s) vieram fora do formato e foram descartados${droppedWhy.size ? ` (${[...droppedWhy].slice(0, 6).join("; ")})` : ""}.`,
			);

		// Espelho do MeuPluggy ainda vazio: veio conta, mas nenhum lançamento nem fatura (agora e antes), e o item foi
		// atualizado ANTES do começo da autorização (`consentExpiresAt` menos 1 ano: a autorização do MeuPluggy dura um
		// ano). O Meu Pluggy só preenche o espelho na atualização seguinte do item original: espera, não é "Sincronizado".
		// INFERÊNCIA do padrão visto em produção (docs/pluggy.md); sem os dois horários o sinal não vale.
		const fetchedAny =
			fetched.some((f) => f.txs.length > 0) || [...billsOf.values()].some((b) => b.bills.length > 0);
		if (
			// Só nos primeiros dias da conexão: conta sem movimento de verdade não fica "esperando o banco" para sempre.
			startedAt.getTime() - connection.createdAt.getTime() < NEW_CONNECTION_MS &&
			linked.length > 0 &&
			!imported &&
			!fetchedAny &&
			failedAccounts === 0 &&
			item.status === "UPDATED" &&
			mirrorNotFilled(item.lastUpdatedAt, item.consentExpiresAt)
		) {
			result.notes.push(
				"O banco entregou a conta, mas ainda não os lançamentos (o Pluggy ainda não preencheu).",
			);
			partial.push("o banco ainda não enviou lançamentos");
			lead ??= PLUGGY_NO_DATA_PREFIX;
			if (lead === PLUGGY_NO_DATA_PREFIX) leadReason = "o banco ainda não enviou lançamentos";
			if (!result.retry) result.retry = { reason: "no_data", ...(notBefore ? { notBefore } : {}) };
		}

		// Fatura ABERTA de cada cartão (o banco não a manda em `/bills`): a soma das compras PENDING, que a doc define como
		// "ainda não incluídas numa fatura fechada". O dono costuma pagar antes de a fatura fechar (o Mercado Pago aceita
		// pagar o valor das pendentes), e esse débito só se liga ao cartão por este total. Entra como fatura sem vencimento.
		for (const { target, txs } of fetched) {
			if (!target.card) continue;
			const pending: Array<{ date: LocalDate; amountCents: number }> = [];
			for (const tx of txs) {
				if (tx.status !== "PENDING" || tx.type !== "DEBIT") continue;
				const facts = transactionFacts(tx);
				if (facts) pending.push(facts);
			}
			const openCents = pending.reduce((total, p) => total + p.amountCents, 0);
			if (openCents > 0) {
				// O pagamento casa com a soma das pendentes até o dia do débito (`pending`), numa janela: compra nova
				// depois do pagamento adiantado não o desfaz, e o total sem data não casa com qualquer dia.
				shared.bills.push({
					cardId: target.card.id,
					totalCents: openCents,
					remainingCents: openCents,
					dueDate: null,
					pending,
				});
			}
		}

		// 2) Casa cada pagamento de fatura com UM lançamento. O pool do banco é da conexão inteira (o pagamento pode
		// sair de qualquer conta); o do cartão é por cartão.
		const matches = new Map<string, BillPayment>();
		const bankPool: PaymentCandidate[] = [];
		for (const { target, txs } of fetched) {
			const pool = txs.flatMap((tx) => {
				if (tx.status === "PENDING") return [];
				// O banco já disse que este crédito do cartão é estorno ou cashback, não pagamento de fatura. (PAGAMENTO não
				// exclui: nos dados reais é o rótulo da baixa da fatura no Inter e no Santander.)
				if (target.card && operationSignal(tx.operationType, "in") === "refund") return [];
				// Tarifa e operação de crédito do cartão (IOF, juros, parcelamento da fatura) também não são pagamento.
				if (target.card && isCardChargeOperation(tx.operationType)) return [];
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

		// 3) Grava. `others` conta, por categoria do Pluggy, o que caiu em "Outros" (diagnóstico; sem descrição nem valor).
		const others = new Map<string, number>();
		const contextOf = (
			target: Linked,
			ownTransferCounterparts?: ReadonlyMap<string, string>,
		): TransactionContext => ({
			accountType: target.account ? "BANK" : "CREDIT",
			accountId: target.account?.id ?? null,
			card: target.card ? { id: target.card.id, config: toCardConfig(target.card) } : null,
			ownerTaxNumber: target.taxNumber,
			ownerName: target.ownerName,
			billPaymentMatches: matches,
			billTotals,
			// Cartões e faturas de todas as conexões já vistas: o pagamento sai de uma conta e pode ser de cartão de outro banco.
			cards: shared.cards,
			bills: shared.bills,
			payments: shared.payments,
			billMonths,
			billsUnavailable,
			...(typeof item.connector?.isOpenFinance === "boolean"
				? { isOpenFinance: item.connector.isOpenFinance }
				: {}),
			...(categoryIndex ? { categoryIndex } : {}),
			...(ownTransferCounterparts ? { ownTransferCounterparts } : {}),
			categoryIds,
			categoryRules,
		});
		// Transferências próprias entre as contas desta conexão: pareia as pontas que casam sem dúvida.
		const legs: OwnTransferLeg[] = [];
		for (const { target, txs } of fetched) {
			if (!target.account) continue;
			for (const tx of txs) {
				const mapped = safeMap(tx, contextOf(target));
				if (mapped?.action !== "upsert" || mapped.input.kind !== "transfer") continue;
				legs.push({
					id: tx.id,
					accountId: target.account.id,
					direction: tx.type === "DEBIT" ? "out" : "in",
					amountCents: mapped.input.amountCents,
					date: mapped.input.date,
					// O mapeamento só grava `transfer` com sinal (CPF/CNPJ, nome do titular, categoria ou texto de titularidade).
					ownerSignal: true,
				});
			}
		}
		const counterparts = pairOwnTransfers(legs);
		// O banco só vale como "completo" com o item atualizado e nenhuma linha descartada: sem isso, o que não veio pode
		// ter ficado de fora da resposta, não ter sido apagado.
		const complete = item.status === "UPDATED" && dropped === 0;
		for (const { target, txs } of fetched) {
			const ctx = contextOf(target, counterparts);
			const seenIds = new Set(txs.map((t) => t.id));
			await storeTransactions(deps, txs, ctx, result, others, seenIds, {
				windowFrom: from,
				seenAt: startedAt,
				// Regra deduzida pelo sync vale sempre (não só na rodada em que mudou): se esta rodada falhar depois de
				// gravar a regra, a próxima ainda refaz as linhas (só as de fatura aberta ou sem pagamento, ver abaixo).
				ruleChanged: target.card
					? ruleChanged.has(target.card.id) || target.card.closingRuleSource === "inferred"
					: false,
			});
			await trackPresence(deps, target, seenIds, { complete, from, today, startedAt }, result);
		}
		if ((result.relinkedAccounts ?? 0) > 0) {
			result.notes.push(
				`${result.relinkedAccounts} conta(s)/cartão(ões) de uma conexão antiga deste banco foram religados à nova, sem duplicar.`,
			);
		}
		if ((result.rekeyed ?? 0) > 0) {
			result.notes.push(
				`${result.rekeyed} lançamento(s) da conexão antiga foram religados à nova, sem duplicar.`,
			);
		}
		if ((result.reclassified ?? 0) > 0) {
			result.notes.push(
				`${result.reclassified} lançamento(s) antigo(s) foram corrigidos (receita ou transferência entre contas suas que estavam como gasto).`,
			);
		}
		if ((result.adopted ?? 0) > 0) {
			result.notes.push(
				`${result.adopted} lançamento(s) que você já tinha feito foram ligados ao banco, sem duplicar.`,
			);
		}
		if ((result.possibleDuplicates ?? 0) > 0) {
			result.notes.push(
				`${result.possibleDuplicates} lançamento(s) do banco parecem repetir mais de um lançamento seu e foram para revisão.`,
			);
		}
		if ((result.pendingStored ?? 0) > 0) {
			result.notes.push(
				`${result.pendingStored} compra(s) da fatura aberta, ainda pendentes no banco, entraram no gasto.`,
			);
		}
		if ((result.recreated ?? 0) > 0) {
			result.notes.push(
				`${result.recreated} lançamento(s) que o banco apagou e recriou com outro id foram religados, sem duplicar.`,
			);
		}
		if ((result.removedByBank ?? 0) > 0) {
			result.notes.push(
				`${result.removedByBank} lançamento(s) que o banco deixou de informar foram removidos.`,
			);
		}
		if ((result.flaggedMissing ?? 0) > 0) {
			result.notes.push(
				`${result.flaggedMissing} lançamento(s) que você editou e o banco deixou de informar foram para revisão.`,
			);
		}
		const othersNote = describeOthers(others);
		if (othersNote !== null) result.notes.push(othersNote);
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
			result.windowDone = partial.every((reason) => formatOnly.has(reason));
			const others = partial.filter((reason) => reason !== leadReason).length;
			result.error =
				lead !== null
					? `${lead} O Órbita tenta de novo sozinho; você também pode tocar em Sincronizar agora mais tarde.${
							others > 0 ? ` · e mais ${others} ${others === 1 ? "aviso" : "avisos"}` : ""
						}`
					: `${capitalize(partial.join("; "))}. Na próxima sincronização o Órbita tenta de novo.`;
		} else if (unreadProducts) {
			result.error = onlyInvestmentsWaiting
				? `${PLUGGY_ONLY_INVESTMENTS_PREFIX} O Órbita tenta de novo sozinho; quando vier conta ou cartão, aparecem aqui.`
				: `${PLUGGY_UNREAD_PRODUCTS_PREFIX} Mande o Diagnóstico da conexão se faltar algo.`;
		}
		return result;
	} catch (e) {
		result.status = "error";
		result.error = safeErrorMessage(e);
		return result;
	}
}

/** Há lançamento ou fatura do Pluggy gravado em alguma das contas/cartões ligados desta conexão? */
async function hasImportedData(deps: SyncPluggyDeps, linked: readonly Linked[]): Promise<boolean> {
	const accountIds = linked.flatMap((l) => (l.account ? [l.account.id] : []));
	const cardIds = linked.flatMap((l) => (l.card ? [l.card.id] : []));
	if (accountIds.length + cardIds.length === 0) return false;
	const found = await deps.stores.transactions.countMatching({
		sources: [PLUGGY_SOURCE],
		...(accountIds.length > 0 ? { accountIds } : {}),
		...(cardIds.length > 0 ? { cardIds } : {}),
	});
	if (found > 0) return true;
	for (const cardId of cardIds) if ((await deps.stores.bills.listByCard(cardId)).length > 0) return true;
	return false;
}

/** O item foi atualizado antes de a autorização começar (`consentExpiresAt` menos 1 ano)? Sem as duas datas, `false`. */
function mirrorNotFilled(
	lastUpdatedAt: string | null | undefined,
	consentExpiresAt: string | null | undefined,
): boolean {
	const updated = lastUpdatedAt ? Date.parse(lastUpdatedAt) : Number.NaN;
	const expires = consentExpiresAt ? Date.parse(consentExpiresAt) : Number.NaN;
	if (!Number.isFinite(updated) || !Number.isFinite(expires)) return false;
	const start = new Date(expires);
	start.setUTCFullYear(start.getUTCFullYear() - 1);
	return updated < start.getTime();
}

/** Conexão "nova" para tentar de novo sozinha quando ainda não trouxe contas: 3 dias. */
const NEW_CONNECTION_MS = 3 * 86_400_000;

/** `nextAutoSyncAt` do item, se é uma data no futuro próximo (até 2 dias); senão `null`. */
function retryNotBefore(nextAutoSyncAt: string | null | undefined, now: Date): string | null {
	const at = nextAutoSyncAt ? Date.parse(nextAutoSyncAt) : Number.NaN;
	if (!Number.isFinite(at) || at <= now.getTime() || at - now.getTime() > 2 * 86_400_000) return null;
	return new Date(at).toISOString();
}

function consentExpired(consentExpiresAt: string | null | undefined, now: Date): boolean {
	const at = consentExpiresAt ? Date.parse(consentExpiresAt) : Number.NaN;
	return Number.isFinite(at) && at < now.getTime();
}

/**
 * `executionStatus` final de um item que não atualizou (docs.pluggy.ai, "Item lifecycle": Error states), em pt-BR
 * curto. Código desconhecido aparece só como código (letras e `_`); texto livre do Pluggy nunca entra.
 */
export function itemProblemText(executionStatus: string | null | undefined): string | null {
	const code = (executionStatus ?? "").trim().toUpperCase();
	if (!/^[A-Z_]{1,60}$/.test(code)) return null;
	const known: Record<string, string> = {
		SITE_NOT_AVAILABLE: "o site do banco está fora do ar",
		CONNECTION_ERROR: "não deu para falar com o banco",
		ACCOUNT_LOCKED: "a conta está bloqueada no banco",
		ACCOUNT_NEEDS_ACTION: "o banco pede uma ação sua no app dele",
		USER_AUTHORIZATION_PENDING: "falta autorizar no app do banco",
		USER_AUTHORIZATION_NOT_GRANTED: "a autorização não foi dada no banco",
		USER_AUTHORIZATION_REVOKED: "a autorização foi retirada no banco",
		USER_NOT_SUPPORTED: "o Pluggy não atende esse tipo de conta",
		MERGE_ERROR: "o Pluggy falhou ao guardar os dados",
		ERROR: "erro inesperado no Pluggy",
	};
	if (code === "SUCCESS" || code === "PARTIAL_SUCCESS") return null;
	return known[code] ?? `código ${code}`;
}

/** Avisos de contas e cartões no `statusDetail` do item: só o produto e o código (a mensagem é texto de terceiro). */
function productWarnings(detail: PluggyItem["statusDetail"]): string[] {
	const out: string[] = [];
	for (const [name, d] of Object.entries(detail ?? {})) {
		if (!/^(accounts|creditCards)$/i.test(name) || !d) continue;
		const codes = (d.warnings ?? [])
			.map((w) => (w.code === null || w.code === undefined ? "" : String(w.code)))
			.filter((c) => /^[A-Za-z0-9_]{1,60}$/.test(c));
		if (d.isUpdated === false || codes.length > 0) {
			out.push(
				`O Pluggy não atualizou ${name === "accounts" ? "as contas" : "os cartões"}${codes.length ? ` (aviso ${codes.join(", ")})` : ""}.`,
			);
		}
	}
	return out.slice(0, 4);
}

/** Nome da conexão a partir das contas dela, se o dono não deu um. Falha aqui nunca derruba a sincronização. */
async function suggestLabel(
	deps: SyncPluggyDeps,
	connection: PluggyConnectionRecord,
	connectorName: string | null | undefined,
	pluggyAccounts: readonly PluggyAccount[],
	investmentIssuers: readonly (string | null | undefined)[] = [],
): Promise<void> {
	// Relê a conexão: o dono pode ter renomeado desde o início da rodada.
	const current = (await deps.stores.pluggyConnections.get(connection.id)) ?? connection;
	const label = chooseConnectionLabel({
		current: current.label,
		connectorName,
		editedByOwner: current.labelEditedByOwner,
		accounts: pluggyAccounts,
		investmentIssuers,
	});
	if (label !== null) await deps.stores.pluggyConnections.setAutoLabel(connection.id, label);
}

/**
 * Saldo, limite disponível e faturas que o banco informou, gravados a cada rodada (ver `balances.ts`). É só registro
 * do que o banco disse: falhar aqui não derruba a sincronização dos lançamentos.
 */
async function storeBankNumbers(
	deps: SyncPluggyDeps,
	pluggyAccounts: readonly PluggyAccount[],
	linked: readonly Linked[],
	billsOf: ReadonlyMap<string, BillsOf>,
	result: ConnectionSyncResult,
): Promise<void> {
	const numbers: BankNumbersResult = { balances: 0, limits: 0, bills: 0, skippedBills: 0 };
	try {
		const at = deps.now();
		await recordBankNumbers(deps.stores, pluggyAccounts, linked, at, numbers);
		await recordBills(deps.stores, billsOf, linked, at, numbers);
	} catch {
		// Sem detalhe: o erro pode carregar dado do banco.
		result.notes.push("Não deu para gravar o saldo, o limite ou as faturas do banco agora.");
	}
	if (numbers.balances + numbers.limits + numbers.bills + numbers.skippedBills > 0) {
		result.bankNumbers = numbers;
	}
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
	ownerName: string | null;
	account: AccountRecord | null;
	card: CardRecord | null;
}

type Inherit<T> = T | "defer" | null;

/** Conta do item antigo do mesmo banco que o item novo deve herdar (ver `relink.ts`). `defer`: esperar a próxima rodada. */
async function inheritAccount(
	deps: SyncPluggyDeps,
	guard: RelinkGuard,
	mapped: Extract<ReturnType<typeof mapPluggyAccount>, { kind: "account" }>,
	currentIds: ReadonlySet<string>,
	rivals: number,
): Promise<Inherit<AccountRecord>> {
	const candidate = pickRelinkAccount(await deps.stores.accounts.list(), currentIds, mapped.input, rivals);
	if (!candidate?.externalId) return null;
	if (await guard.undecided()) return "defer";
	if (await guard.heldElsewhere(candidate.externalId)) return null;
	return deps.stores.accounts.relinkExternal(candidate.id, mapped.externalId);
}

async function inheritCard(
	deps: SyncPluggyDeps,
	guard: RelinkGuard,
	mapped: Extract<ReturnType<typeof mapPluggyAccount>, { kind: "card" }>,
	currentIds: ReadonlySet<string>,
	rivals: number,
): Promise<Inherit<CardRecord>> {
	const candidate = pickRelinkCard(await deps.stores.cards.list(), currentIds, mapped.input, rivals);
	if (!candidate?.externalId) return null;
	if (await guard.undecided()) return "defer";
	if (await guard.heldElsewhere(candidate.externalId)) return null;
	return deps.stores.cards.relinkExternal(candidate.id, mapped.externalId);
}

/**
 * Depois de religar contas ao item novo, arquiva (`remove`: só para de sincronizar; contas e lançamentos ficam) as
 * conexões antigas do mesmo banco que estão paradas (pedem login) ou que o Pluggy já esqueceu.
 */
async function retireOldConnections(
	deps: SyncPluggyDeps,
	guard: RelinkGuard,
	connection: PluggyConnectionRecord,
	connector: { id?: number | null | undefined; name?: string | undefined } | null | undefined,
	bankName: string | null,
	result: ConnectionSyncResult,
): Promise<void> {
	try {
		const names = [connector?.name, bankName, connection.label].filter((n): n is string => !!n);
		const old = await guard.retirable(connector?.id ?? null, names);
		for (const o of old) {
			if (await deps.stores.pluggyConnections.remove(o.id)) {
				result.notes.push(`A conexão antiga "${o.label ?? "sem nome"}" foi arquivada: a nova a substitui.`);
			}
		}
	} catch {
		result.notes.push("Não deu para arquivar a conexão antiga agora.");
	}
}

/** Acha ou cria a conta/cartão do Órbita de cada conta do Pluggy. */
async function linkAccounts(
	deps: SyncPluggyDeps,
	pluggyAccounts: readonly PluggyAccount[],
	connectorName: string | null | undefined,
	billsOf: ReadonlyMap<string, BillsOf>,
	result: ConnectionSyncResult,
	bankName: string | null,
	guard: RelinkGuard,
): Promise<{ linked: Linked[]; deferredCards: number; deferredRelink: number; relinked: number }> {
	const { accounts, cards } = deps.stores;
	const out: Linked[] = [];
	let deferredCards = 0;
	let deferredRelink = 0;
	let relinked = 0;
	const currentIds: ReadonlySet<string> = new Set(pluggyAccounts.map((a) => a.id));
	const mappedAll = pluggyAccounts.map((pa) => ({
		pa,
		mapped: mapPluggyAccount(
			pa,
			connectorName,
			billsOf.get(pa.id)?.bills,
			// O banco citado no próprio cartão vale mais que o da conexão.
			findKnownBank(pa.marketingName) ?? findKnownBank(pa.name) ?? bankName,
		),
	}));
	// Quantas contas/cartões novos "parecem" a mesma (mesmo nome e banco): com mais de uma, não dá para saber qual herda.
	const identity = (m: MappedAccount) =>
		m.kind === "ignored"
			? ""
			: [
					m.kind,
					m.input.name.toLowerCase(),
					m.input.bankCode ?? "",
					m.kind === "card" ? (m.input.last4 ?? "") : "",
				].join("|");
	const sameAs = (m: MappedAccount) => mappedAll.filter((o) => identity(o.mapped) === identity(m)).length;
	for (const { pa, mapped } of mappedAll) {
		if (mapped.kind === "ignored") {
			// Tipos que o Órbita não usa (investimento) são normais; o resto merece aviso.
			if (pa.type === "BANK" || pa.type === "CREDIT") result.notes.push(`Conta ignorada: ${mapped.reason}.`);
			continue;
		}
		result.accounts += 1;
		if (mapped.kind === "account") {
			let account = await accounts.findByExternal(PLUGGY_SOURCE, mapped.externalId);
			if (!account) {
				const inherited = await inheritAccount(deps, guard, mapped, currentIds, sameAs(mapped));
				if (inherited === "defer") {
					deferredRelink += 1;
					result.notes.push(
						`A conta "${mapped.input.name}" ainda não foi ligada: não deu para conferir as outras conexões.`,
					);
					continue;
				}
				if (inherited) {
					account = inherited;
					relinked += 1;
					result.relinkedAccounts = (result.relinkedAccounts ?? 0) + 1;
				}
			}
			if (!account) {
				try {
					account = await accounts.create(mapped.input);
				} catch (e) {
					if (!(e instanceof DataError && e.code === "duplicate")) throw e;
					account = await accounts.findByExternal(PLUGGY_SOURCE, mapped.externalId);
				}
			} else if (
				account.archivedAt === null &&
				account.name !== mapped.input.name &&
				(hasMeuPluggyPrefix(account.name) ||
					isGeneratedAccountName(account.name) ||
					isLegacyRawName(account.name, pa.marketingName?.trim() || pa.name))
			) {
				// Importada antes da limpeza do nome ("MeuPluggy Inter"): o prefixo é a marca de que o dono ainda não
				// mexeu no nome, então troca uma vez; depois do nome novo isto não roda de novo.
				account = await accounts.update(account.id, { name: mapped.input.name });
			}
			// Emissor pela conexão (ISPB): a conta antiga, sem banco, ganha uma vez; o que o dono escolheu fica.
			if (account && account.archivedAt === null && account.bankCode === null && mapped.input.bankCode) {
				account = await accounts.update(account.id, { bankCode: mapped.input.bankCode });
			}
			out.push({
				pluggyId: pa.id,
				taxNumber: pa.taxNumber ?? null,
				ownerName: pa.owner ?? null,
				account,
				card: null,
			});
			continue;
		}
		let card = await cards.findByExternal(PLUGGY_SOURCE, mapped.externalId);
		if (!card) {
			const inherited = await inheritCard(deps, guard, mapped, currentIds, sameAs(mapped));
			if (inherited === "defer") {
				deferredRelink += 1;
				result.notes.push(
					`O cartão "${mapped.input.name}" ainda não foi ligado: não deu para conferir as outras conexões.`,
				);
				continue;
			}
			if (inherited) {
				card = inherited;
				relinked += 1;
				result.relinkedAccounts = (result.relinkedAccounts ?? 0) + 1;
			}
		}
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
		// Nome ruim ("G", "Mastercard Gold") ou com o prefixo "MeuPluggy": ganha o nome do banco. O dono que trocou o
		// nome por um bom nome não é afetado (só nome fraco é trocado, e só por um que não é fraco).
		if (
			card &&
			card.archivedAt === null &&
			card.name !== mapped.input.name &&
			(hasMeuPluggyPrefix(card.name) ||
				isGeneratedAccountName(card.name) ||
				isLegacyRawName(card.name, pa.marketingName?.trim() || pa.name) ||
				(isWeakCardName(card.name) && !isWeakCardName(mapped.input.name)))
		) {
			card = await cards.update(card.id, { name: mapped.input.name });
		}
		// Emissor pela conexão: o cartão gravado antes de saber o banco ("FREE VISA" sem "Santander") ganha o ISPB, uma vez,
		// e o nome que é só o do Pluggy ganha o banco na frente. O nome que o dono trocou não é tocado.
		if (card && card.archivedAt === null && card.bankCode === null && mapped.input.bankCode) {
			card = await cards.update(card.id, { bankCode: mapped.input.bankCode });
		}
		if (
			card &&
			card.archivedAt === null &&
			card.name !== mapped.input.name &&
			mapped.input.name.toLowerCase().endsWith(` ${card.name.toLowerCase()}`)
		) {
			card = await cards.update(card.id, { name: mapped.input.name });
		}
		out.push({
			pluggyId: pa.id,
			taxNumber: pa.taxNumber ?? null,
			ownerName: pa.owner ?? null,
			account: null,
			card,
		});
	}
	return { linked: out, deferredCards, deferredRelink, relinked };
}

/**
 * O começo da janela. Conexão nova (sem sincronização boa) ou que nunca buscou os 6 meses (`historyFrom` ausente ou
 * mais recente que hoje − 183 dias, como as criadas quando o histórico era de 4 meses): desde hoje − 183 dias, uma vez
 * (a rodada boa registra `historyFrom`). Depois: no mínimo 4 meses, ou mais se a última sincronização boa for anterior,
 * limitado aos 6 meses (uma conexão `partial` permanente não pode fazer a janela crescer sem teto).
 */
export function syncWindowStart(
	today: string,
	connection: Pick<PluggyConnectionRecord, "lastSyncAt" | "historyFrom" | "accountCount" | "cardCount">,
	/** Já há lançamento ou fatura do Pluggy importado nas contas desta conexão? `false` = ainda é a primeira busca. */
	imported = true,
): string {
	const full = addDays(today, -FIRST_SYNC_DAYS);
	const { lastSyncAt, historyFrom } = connection;
	// Sem conta nem cartão a conexão ainda não buscou nada: a versão antiga gravava "ok" com zero contas e já avançava
	// `lastSyncAt` e `historyFrom`. Quando as contas chegam, é a primeira busca de verdade.
	const neverHadAccounts = connection.accountCount + connection.cardCount === 0;
	if (lastSyncAt === null || historyFrom === null || historyFrom > full || neverHadAccounts || !imported)
		return full;
	const routine = addDays(today, -ROUTINE_SYNC_DAYS);
	const overlap = addDays(toLocalDate(lastSyncAt), -OVERLAP_DAYS);
	// Teto: a janela cresce quando a última sincronização boa é antiga, mas nunca passa dos 6 meses iniciais.
	const start = [routine, overlap].sort()[0] ?? routine;
	return [start, full].sort().at(-1) ?? full;
}

const bump = (counts: ConnectionSyncResult["skipped"], key: SkipReason | "archived_account") => {
	counts[key] = (counts[key] ?? 0) + 1;
};

/**
 * A regra de fechamento mudou: só se refaz a linha de fatura ainda aberta ou fechada sem pagamento conhecido. Fatura já
 * paga (ou com pagamento atribuído a ela) foi quitada pelo total que o dono viu; mover compra dela adulteraria o histórico.
 */
async function invoiceCanBeRecomputed(
	transactions: SyncPluggyDeps["stores"]["transactions"],
	card: { id: string; config: CardConfig },
	month: MonthKey,
	today: LocalDate,
): Promise<boolean> {
	if (invoiceStatus(invoiceByMonth(month, card.config), today) === "open") return true;
	return (await transactions.listCardPayments(card.id, paymentWindow(month, card.config))).length === 0;
}

async function storeTransactions(
	deps: SyncPluggyDeps,
	txs: readonly PluggyTransaction[],
	ctx: TransactionContext,
	result: ConnectionSyncResult,
	others: Map<string, number>,
	/** Os ids do Pluggy desta resposta: o que está gravado com OUTRO id do Pluggy veio de um item antigo. */
	currentIds: ReadonlySet<string>,
	bank: {
		windowFrom: string;
		seenAt: Date;
		/** A regra de fechamento deste cartão mudou nesta rodada: a fatura calculada (sem `billId`) é refeita. */
		ruleChanged?: boolean;
	},
): Promise<void> {
	const { transactions } = deps.stores;
	// Contas do mesmo banco deste cartão (uma vez por rodada): notificação "Você pagou…" de alvo incerto pode ter ido
	// para uma delas, e o banco sabe que foi no cartão.
	let sameBank: string[] | undefined;
	const bankAccounts = async () => {
		if (sameBank === undefined) sameBank = ctx.card ? await sameBankAccountIds(deps.stores, ctx.card.id) : [];
		return sameBank;
	};
	// Estornos por último: assim a compra original, se veio na mesma resposta, já está gravada.
	const mappedAll = txs.map((tx) => ({ tx, mapped: safeMap(tx, ctx) }));
	// Quantos do banco têm a mesma identidade (valor, dia, descrição…): casam um a um com os do item antigo.
	const twins = new Map<string, number>();
	const keyOf = (m: Extract<MappedTransaction, { action: "upsert" | "refund" }>) =>
		relinkKey(m.input, "installment" in m ? m.installment : undefined);
	for (const { mapped } of mappedAll) {
		if (mapped?.action === "upsert" || mapped?.action === "refund") {
			twins.set(keyOf(mapped), (twins.get(keyOf(mapped)) ?? 0) + 1);
		}
	}
	// Lançamentos do banco ainda sem resolução: servem a contar "gêmeos" quando o banco recria um lançamento com id novo.
	const batch: BatchPeer[] = mappedAll.flatMap(({ mapped }) =>
		mapped?.action === "upsert" || mapped?.action === "refund"
			? [
					{
						externalId: mapped.externalId,
						input: mapped.input,
						installment: "installment" in mapped ? mapped.installment : undefined,
					},
				]
			: [],
	);
	const resolved = new Set<string>();
	const newPeers = async () => {
		const out: BatchPeer[] = [];
		for (const peer of batch) {
			if (resolved.has(peer.externalId)) continue;
			if (await transactions.existsByExternal(PLUGGY_SOURCE, peer.externalId)) continue;
			out.push(peer);
		}
		return out;
	};
	const rekey = async (m: Extract<MappedTransaction, { action: "upsert" | "refund" }>) => {
		// O banco apagou e recriou com id novo: só troca o id, nada duplica. Primeiro pelas âncoras do próprio banco
		// (providerId, providerCode), depois o item antigo do mesmo banco (`relink.ts`) e por último pelos atributos.
		const recreatedContext = { currentIds, windowFrom: bank.windowFrom, peers: newPeers };
		const byAnchor = await reconcileRecreated(transactions, m, recreatedContext, "anchors");
		if (byAnchor.outcome === "rekeyed") result.recreated = (result.recreated ?? 0) + 1;
		if (byAnchor.outcome !== "none") return byAnchor;
		const key = keyOf(m);
		const left = twins.get(key) ?? 1;
		twins.set(key, left - 1);
		const out = await rekeyRelinked(transactions, m, currentIds, left);
		if (out.outcome === "rekeyed") result.rekeyed = (result.rekeyed ?? 0) + 1;
		if (out.outcome !== "none") return out;
		const byAttributes = await reconcileRecreated(transactions, m, recreatedContext, "attributes");
		if (byAttributes.outcome === "rekeyed") result.recreated = (result.recreated ?? 0) + 1;
		return byAttributes;
	};
	const ordered = [
		...mappedAll.filter((m) => m.mapped?.action !== "refund"),
		...mappedAll.filter((m) => m.mapped?.action === "refund"),
	];
	let previous: string | null = null;
	for (const { mapped } of ordered) {
		if (previous !== null) resolved.add(previous);
		previous = mapped && mapped.action !== "skip" ? mapped.externalId : null;
		try {
			if (mapped === null) {
				result.failed += 1;
				continue;
			}
			if (mapped.action === "skip") {
				bump(result.skipped, mapped.reason);
				continue;
			}
			// (o próprio lançamento só sai do lote depois de tratado: `resolved` recebe o anterior a cada volta)
			// O banco havia "removido" este lançamento (sumiu por dias) e o trouxe de volta com o mesmo id: volta a existir.
			if (!(await transactions.findByExternal(PLUGGY_SOURCE, mapped.externalId))) {
				if (await transactions.reviveRemovedByBank(PLUGGY_SOURCE, mapped.externalId, bank.seenAt)) {
					result.restored = (result.restored ?? 0) + 1;
				}
			}
			if (mapped.action === "upsert") {
				// Primeiro o que um item ANTIGO do mesmo banco já gravou (só troca o id); depois o lançamento do dono.
				const relinkedTx = await rekey(mapped);
				const early =
					relinkedTx.outcome === "none"
						? await adoptEarlyEntry(
								transactions,
								PLUGGY_SOURCE,
								mapped,
								mapped.input.cardId ? await bankAccounts() : [],
							)
						: relinkedTx.outcome === "ambiguous"
							? relinkedTx
							: ({ outcome: "none" } as const);
				if (early.outcome === "adopted") result.adopted = (result.adopted ?? 0) + 1;
				// Vários lançamentos do dono servem: não adota às cegas. Grava o do banco para revisão.
				const toStore =
					early.outcome === "ambiguous"
						? {
								...mapped,
								input: {
									...mapped.input,
									status: "pending" as const,
									note: mapped.input.note ?? POSSIBLE_DUPLICATE_NOTE,
								},
							}
						: mapped;
				const res = await upsertTransaction(transactions, toStore, result);
				if (early.outcome === "ambiguous" && res.created)
					result.possibleDuplicates = (result.possibleDuplicates ?? 0) + 1;
				if (res.created) {
					result.created += 1;
					if (mapped.input.bankPending) result.pendingStored = (result.pendingStored ?? 0) + 1;
					if (mapped.categorySource === "none" && mapped.input.kind === "expense") {
						const label = mapped.input.sourceCategory ?? NO_SOURCE_CATEGORY;
						others.set(label, (others.get(label) ?? 0) + 1);
					}
				} else {
					if (res.transaction && (await refreshFromBank(transactions, res.transaction, mapped.input))) {
						// A pendente que o banco efetivou foi atualizada no lugar (mesmo id, ou religada por providerId).
						if (res.transaction.bankPending && !mapped.input.bankPending)
							result.settled = (result.settled ?? 0) + 1;
					}
					if (res.transaction && (await fixKind(transactions, res.transaction, mapped.input))) {
						result.reclassified = (result.reclassified ?? 0) + 1;
					}
					// A fatura que o banco indica vale mais que a gravada por quem só calculava pelo fechamento: a
					// compra pesa no mês dela (o upsert por si só nunca corrigia). O que o engine calculou não mexe.
					// Também recalcula a compra ainda pendente sem fatura do banco: versões antigas gravavam nela o mês de
					// `billForecastDate` (hoje ignorado em conector que não é Open Finance) e a fatura ficava errada para sempre.
					// Regra de fechamento mudada agora: a efetivada sem fatura do banco (`billId`), que o engine calculou pela
					// regra antiga, também é refeita.
					if (
						(mapped.invoiceFromBill ||
							(bank.ruleChanged === true &&
								ctx.card != null &&
								res.transaction?.invoiceMonth != null &&
								// Compara antes do await: com a fatura já certa não há o que refazer nem consulta a gastar.
								mapped.input.invoiceMonth != null &&
								res.transaction.invoiceMonth !== mapped.input.invoiceMonth &&
								(await invoiceCanBeRecomputed(
									transactions,
									ctx.card,
									res.transaction.invoiceMonth,
									toLocalDate(bank.seenAt),
								))) ||
							mapped.input.bankPending === true ||
							res.transaction?.bankPending === true) &&
						res.transaction &&
						!touchedByOwner(res.transaction) &&
						res.transaction.cardId != null &&
						mapped.input.invoiceMonth != null &&
						res.transaction.invoiceMonth !== mapped.input.invoiceMonth
					) {
						await transactions.update(res.transaction.id, { invoiceMonth: mapped.input.invoiceMonth });
						result.reclassified = (result.reclassified ?? 0) + 1;
					}
					// Compra no cartão: o gasto pesa pela data da compra. Linha gravada quando o gasto seguia a fatura (ou
					// com o dia do lançamento da fatura) volta para a data e o mês certos; a do dono editada fica como está.
					if (
						ctx.card &&
						res.transaction &&
						res.transaction.kind === "expense" &&
						mapped.input.kind === "expense" &&
						!touchedByOwner(res.transaction) &&
						mapped.input.budgetMonth != null &&
						(res.transaction.date !== mapped.input.date ||
							res.transaction.budgetMonth !== mapped.input.budgetMonth)
					) {
						await transactions.update(res.transaction.id, {
							date: mapped.input.date,
							budgetMonth: mapped.input.budgetMonth,
						});
						result.reclassified = (result.reclassified ?? 0) + 1;
					}
					const nextCategoryId = mapped.input.categoryId ?? null;
					if (
						res.transaction &&
						shouldUpgradeCategory(res.transaction, nextCategoryId, ctx.categoryIds?.get("outros") ?? null)
					) {
						await transactions.update(res.transaction.id, { categoryId: nextCategoryId });
					} else if (
						res.transaction &&
						shouldRecategorizeDigital(res.transaction, {
							categorySource: mapped.categorySource,
							categoryId: nextCategoryId,
						})
					) {
						// Google Play que um sync antigo gravou em Moradia (ou outra): vai para Assinaturas, se o dono não escolheu.
						await transactions.update(res.transaction.id, { categoryId: nextCategoryId });
						result.reclassified = (result.reclassified ?? 0) + 1;
					}
					result.existing += 1;
				}
				continue;
			}
			// Estorno: só entra se a compra original está gravada. Sem ela, fica de fora e a próxima rodada tenta de novo.
			if (await transactions.existsByExternal(PLUGGY_SOURCE, mapped.externalId)) {
				// Estorno na conta que um sync antigo gravou como receita: vira estorno assim que a despesa original aparece.
				const stored = await transactions.findByExternal(PLUGGY_SOURCE, mapped.externalId);
				// Estorno gravado sem a compra (crédito no cartão): se ela apareceu depois, liga agora (o dono não mexeu).
				if (stored && stored.kind === "refund" && stored.refundOfId === null && !touchedByOwner(stored)) {
					const found = ctx.card
						? await findRefundOriginal(
								transactions,
								ctx.card,
								mapped.original,
								mapped.input.invoiceMonth as MonthKey,
							)
						: ctx.accountId
							? await findAccountRefundOriginal(transactions, ctx.accountId, mapped.original)
							: null;
					if (found !== null) await transactions.update(stored.id, { refundOfId: found });
				}
				if (!ctx.card && stored && stored.kind === "income" && !touchedByOwner(stored) && ctx.accountId) {
					const originalId = await findAccountRefundOriginal(transactions, ctx.accountId, mapped.original);
					if (originalId !== null) {
						await transactions.update(stored.id, { kind: "refund", refundOfId: originalId });
						result.reclassified = (result.reclassified ?? 0) + 1;
					}
				}
				result.existing += 1;
				continue;
			}
			const relinkedRefund = await rekey(mapped);
			if (relinkedRefund.outcome === "rekeyed") {
				result.existing += 1;
				continue;
			}
			let originalId: string | null = null;
			if (ctx.card) {
				originalId = await findRefundOriginal(
					transactions,
					ctx.card,
					mapped.original,
					mapped.input.invoiceMonth as MonthKey,
				);
			} else if (ctx.accountId) {
				originalId = await findAccountRefundOriginal(transactions, ctx.accountId, mapped.original);
			}
			// Crédito no cartão que não é pagamento de fatura (o mapeamento já descartou esses) entra como estorno mesmo sem
			// achar a compra: estorno parcial, com outra descrição, de parcelada, cashback, anuidade ou IOF estornados. O
			// engine abate da própria categoria e o excedente vira crédito (`refundCreditCents`). Na conta, sem a original,
			// continua fora: lá o crédito pode ser outra coisa.
			if (originalId === null && !ctx.card) {
				bump(result.skipped, "refund_without_original");
				continue;
			}
			const res = await transactions.upsertByExternal(PLUGGY_SOURCE, mapped.externalId, {
				...mapped.input,
				...(relinkedRefund.outcome === "ambiguous"
					? { status: "pending" as const, note: mapped.input.note ?? POSSIBLE_DUPLICATE_NOTE }
					: {}),
				...(originalId === null ? {} : { refundOfId: originalId }),
			});
			if (res.created && relinkedRefund.outcome === "ambiguous") {
				result.possibleDuplicates = (result.possibleDuplicates ?? 0) + 1;
			}
			if (res.created) result.created += 1;
			else result.existing += 1;
		} catch (e) {
			// Um lançamento ruim não derruba os outros. O motivo detalhado não vai para o banco.
			if (e instanceof DataError || e instanceof RangeError) result.failed += 1;
			else throw e;
		}
	}
}

/**
 * O que o banco informa e muda sozinho num lançamento que já existe: se ainda está pendente, os identificadores dele
 * (`providerId`, `providerCode`) e, enquanto estava pendente, o valor (a Pluggy atualiza no lugar quando a fatura vence:
 * docs.pluggy.ai/docs/transactions, "Most changes — including the PENDING → POSTED transition — arrive as an in-place
 * update"). A pendência é um fato do banco, não uma escolha do dono: vale para todo lançamento; o valor só para o que o
 * dono não editou. Data e fatura seguem os blocos de `invoiceFromBill` e de data da compra, logo abaixo no chamador.
 */
async function refreshFromBank(
	transactions: SyncPluggyDeps["stores"]["transactions"],
	current: TransactionRecord,
	next: UpsertByExternalInput,
): Promise<boolean> {
	const patch: TransactionPatch = {};
	const pending = next.bankPending === true;
	if (current.bankPending !== pending) patch.bankPending = pending;
	if (current.providerId === null && next.providerId) patch.providerId = next.providerId;
	if (current.providerCode === null && next.providerCode) patch.providerCode = next.providerCode;
	if (
		current.bankPending &&
		!touchedByOwner(current) &&
		current.kind === "expense" &&
		next.kind === "expense" &&
		next.amountCents !== current.amountCents
	) {
		patch.amountCents = next.amountCents;
	}
	if (Object.keys(patch).length === 0) return false;
	await transactions.update(current.id, patch);
	return true;
}

/**
 * Depois de gravar a resposta de UMA conta/cartão: marca como vistos os lançamentos que vieram e trata os que o banco
 * parou de informar (`reviewVanished`). Só com a resposta completa (item atualizado, nada descartado).
 */
async function trackPresence(
	deps: SyncPluggyDeps,
	target: Linked,
	seenIds: ReadonlySet<string>,
	when: { complete: boolean; from: string; today: string; startedAt: Date },
	result: ConnectionSyncResult,
): Promise<void> {
	const { transactions } = deps.stores;
	await transactions.markSeen(PLUGGY_SOURCE, [...seenIds].slice(0, 500), when.startedAt);
	for (let i = 500; i < seenIds.size; i += 500) {
		await transactions.markSeen(PLUGGY_SOURCE, [...seenIds].slice(i, i + 500), when.startedAt);
	}
	if (!when.complete) return;
	const owner = target.account ?? target.card;
	if (!owner) return;
	const done = await reviewVanished(transactions, {
		target: target.account ? { accountId: owner.id } : { cardId: owner.id },
		seenIds,
		from: when.from,
		today: when.today,
		now: when.startedAt,
	});
	// Notificação que o banco nunca confirmou (cartão/conta lidos por inteiro agora): vai para revisão, nunca some.
	await flagUnconfirmedNotifications(transactions, {
		target: target.account ? { accountId: owner.id } : { cardId: owner.id },
		today: when.today,
		syncedAt: when.startedAt,
	});
	if (done.removed > 0) result.removedByBank = (result.removedByBank ?? 0) + done.removed;
	if (done.flagged > 0) result.flaggedMissing = (result.flaggedMissing ?? 0) + done.flagged;
	if (done.skippedMass) {
		result.notes.push(
			"O banco deixou de informar muitos lançamentos de uma conta de uma vez; não apaguei nada (pode ser instabilidade).",
		);
	}
}

/**
 * Recálculo do que já foi gravado errado (a sincronização é idempotente e nunca mexia no tipo). Só quando o lançamento
 * existente é despesa ou receita e o mapeamento de hoje diz o contrário, e nunca se o dono mexeu no lançamento
 * (`touchedByOwner`: categoria trocada, tipo/data/valor/conta corrigidos ou pendente confirmado):
 * - o mapeamento diz `investment` (aplicação) e está gravado como despesa → vira `investment`: sai do gasto e vai
 *   para o "Investido" (e, se já era `investment`, nada muda);
 * - entrou dinheiro (o Pluggy diz CREDIT, o mapeamento diz `income`) e está gravado como despesa → vira receita;
 * - resgate de investimento (o mapeamento diz `redemption`) gravado como despesa ou receita → vira `redemption`: deixa
 *   de contar como renda e abate o "Investido";
 * - o mapeamento reconhece transferência para si mesmo e está gravado como despesa ou receita → vira `transfer` no
 *   lugar (continua nas Atividades, categoria mantida, observação avisando) e deixa de contar como gasto ou renda;
 * - já é `transfer` sem destino e agora há um par único → preenche o destino.
 */
async function fixKind(
	transactions: SyncPluggyDeps["stores"]["transactions"],
	current: {
		id: string;
		kind: string;
		categoryEditedByOwner: boolean;
		editedByOwner: boolean;
		note: string | null;
		counterpartAccountId: string | null;
		cardId?: string | null;
	},
	next: {
		kind: string;
		categoryId?: string | null | undefined;
		counterpartAccountId?: string | null | undefined;
		cardId?: string | null | undefined;
		status?: string | undefined;
		note?: string | null | undefined;
	},
): Promise<boolean> {
	if (touchedByOwner(current)) return false;
	// Pagamento de fatura: gravado como gasto/transferência (ou "Fatura de cartão"/revisão) e agora o mapeamento sabe de
	// qual cartão é → vira `card_payment` (0 no gasto). Idempotente: depois de virar, `current.kind` já é card_payment.
	if (
		next.kind === "card_payment" &&
		next.cardId &&
		(current.kind === "expense" || current.kind === "transfer")
	) {
		await transactions.update(current.id, {
			kind: "card_payment",
			cardId: next.cardId,
			counterpartAccountId: null,
			categoryId: null,
			status: "confirmed",
			note: isPaymentNote(current.note) ? null : current.note,
		});
		return true;
	}
	// Pagamento de fatura sem cartão que combine: rotula (uma vez só: a nota marca que já foi tratado).
	const flagged = next.note === PAYMENT_UNCONNECTED_NOTE || next.note === PAYMENT_REVIEW_NOTE;
	if (flagged && next.kind === "expense" && current.note === null && current.kind !== "card_payment") {
		if (current.kind !== "expense" && current.kind !== "transfer") return false;
		await transactions.update(current.id, {
			kind: "expense",
			counterpartAccountId: null,
			note: next.note ?? null,
			...(next.status === "pending" ? { status: "pending" as const } : {}),
			...(next.categoryId ? { categoryId: next.categoryId } : {}),
		});
		return true;
	}
	if (current.kind === "expense" && next.kind === "investment") {
		await transactions.update(current.id, { kind: "investment", categoryId: next.categoryId ?? null });
		return true;
	}
	if (current.kind === "expense" && next.kind === "income") {
		await transactions.update(current.id, { kind: "income", categoryId: next.categoryId ?? null });
		return true;
	}
	// Resgate gravado como despesa ou receita (antes o principal que voltava contava como renda): vira `redemption`.
	if ((current.kind === "expense" || current.kind === "income") && next.kind === "redemption") {
		await transactions.update(current.id, { kind: "redemption", categoryId: next.categoryId ?? null });
		return true;
	}
	if (next.kind !== "transfer") return false;
	if (current.kind === "expense" || current.kind === "income") {
		await transactions.update(current.id, {
			kind: "transfer",
			counterpartAccountId: next.counterpartAccountId ?? null,
			...(current.note === null ? { note: RECOMPUTED_NOTE } : {}),
		});
		return true;
	}
	if (current.kind === "transfer" && current.counterpartAccountId === null && next.counterpartAccountId) {
		await transactions.update(current.id, { counterpartAccountId: next.counterpartAccountId });
		return true;
	}
	return false;
}

const RECOMPUTED_NOTE = RECOMPUTED_TRANSFER_NOTE;
const NO_SOURCE_CATEGORY = "sem categoria do banco";
const OTHERS_SHOWN = 8;

/** "Outros: Transfer - PIX ×12, Shopping ×3": só categorias do banco e contagens, para ajustar as tabelas. */
export function describeOthers(others: ReadonlyMap<string, number>): string | null {
	if (others.size === 0) return null;
	const ordered = [...others].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
	const shown = ordered.slice(0, OTHERS_SHOWN).map(([name, n]) => `${name.slice(0, 60)} ×${n}`);
	const rest = ordered.slice(OTHERS_SHOWN).reduce((sum, [, n]) => sum + n, 0);
	return `Outros: ${shown.join(", ")}${rest > 0 ? `, mais ${rest}` : ""}`;
}

/**
 * Grava a despesa. Parcela de compra parcelada entra no grupo da compra; se o grupo já tem OUTRA compra naquele número
 * (duas compras iguais no mesmo dia, indistinguíveis), grava avulsa com a nota "Parcela n/N" para não perder o gasto.
 */
async function upsertTransaction(
	transactions: SyncPluggyDeps["stores"]["transactions"],
	mapped: Extract<MappedTransaction, { action: "upsert" }>,
	result: ConnectionSyncResult,
) {
	if (!mapped.installment)
		return transactions.upsertByExternal(PLUGGY_SOURCE, mapped.externalId, mapped.input);
	try {
		return await transactions.upsertInstallmentByExternal(
			PLUGGY_SOURCE,
			mapped.externalId,
			mapped.input,
			mapped.installment,
		);
	} catch (e) {
		if (!(e instanceof DataError) || e.code !== "duplicate") throw e;
		const collision = "Duas compras parceladas iguais (mesmo dia, mesmo valor) viraram parcelas avulsas.";
		if (!result.notes.includes(collision)) result.notes.push(collision);
		const { number, count } = mapped.installment;
		return transactions.upsertByExternal(PLUGGY_SOURCE, mapped.externalId, {
			...mapped.input,
			note: mapped.input.note ?? `Parcela ${number}/${count}`,
		});
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

/** Palavras de estorno/devolução que não dizem de qual compra é. */
const REFUND_FILLER = new Set([
	"estorno",
	"estornos",
	"estornado",
	"estornada",
	"devolucao",
	"devolvido",
	"devolvida",
	"refund",
	"chargeback",
	"compra",
	"pix",
	"debito",
	"cartao",
	"pagamento",
	"credito",
	"recebido",
	"recebida",
	"enviado",
	"enviada",
	"transferencia",
	"transf",
	"para",
	"por",
	"com",
	"dos",
	"das",
]);

const refundWords = (text: string) =>
	plain(text)
		.split(/[^a-z0-9]+/)
		.filter((w) => w.length >= 3 && !REFUND_FILLER.has(w) && !/^\d+$/.test(w));

/** Quantos dias para trás a despesa de um estorno na conta pode estar. */
const ACCOUNT_REFUND_LOOKBACK_DAYS = 90;

/**
 * A despesa que um estorno/devolução na CONTA desfaz: mesma conta, mesmo valor, de data igual ou anterior (até 90
 * dias) e ainda sem estorno. A descrição do estorno ("Estorno compra Mercado X") precisa citar uma palavra da despesa;
 * estorno sem palavra que sirva (só "Estorno") casa com a única despesa de mesmo valor. Na dúvida, o mais recente.
 */
async function findAccountRefundOriginal(
	transactions: SyncPluggyDeps["stores"]["transactions"],
	accountId: string,
	original: { amountCents: number; description: string; date: string },
): Promise<string | null> {
	const range = { from: addDays(original.date, -ACCOUNT_REFUND_LOOKBACK_DAYS), to: original.date };
	const rows = await transactions.listByTarget({ accountId }, range);
	const refunded = new Set(rows.filter((r) => r.kind === "refund").map((r) => r.refundOfId));
	const wanted = refundWords(original.description);
	const sameAmount = rows.filter(
		(r) => r.kind === "expense" && r.amountCents === original.amountCents && !refunded.has(r.id),
	);
	const named = sameAmount.filter((r) => {
		const words = refundWords(r.description);
		return wanted.some((w) => words.includes(w) || plain(r.description).includes(w));
	});
	const pool = wanted.length > 0 ? named : sameAmount.length === 1 ? sameAmount : [];
	return [...pool].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))[0]?.id ?? null;
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
