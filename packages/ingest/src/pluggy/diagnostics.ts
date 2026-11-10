import { decimalToCents, formatBRL } from "@orbita/core";
import type {
	DiagAccount,
	DiagBill,
	DiagConnection,
	DiagError,
	DiagInvestment,
	DiagInvestments,
	DiagInvestmentTransaction,
	DiagLink,
	DiagMoney,
	DiagParty,
	DiagTransaction,
} from "@orbita/shared";
import type { PluggyClient } from "./client.ts";
import { PluggyError, pluggyError } from "./errors.ts";
import {
	type InvestmentsRead,
	readInvestments,
	readInvestmentTransactions,
	toInvestmentPosition,
} from "./investments.ts";
import { mapPluggyAccount } from "./mapping.ts";
import {
	accountFields,
	investmentSchema,
	type PluggyAccount,
	type PluggyInvestment,
	type PluggyInvestmentTransaction,
	type PluggyItem,
	type PluggyTransaction,
} from "./schemas.ts";

/*
 * Diagnóstico somente leitura: chama o Pluggy ao vivo e devolve um resumo REDIGIDO. Nada aqui grava, e nada daqui
 * vira dado do Órbita. Redação (docs/seguranca.md): nunca CPF/CNPJ nem número de conta/cartão inteiros; do ID do item
 * e da conta só o começo. Texto vindo do Pluggy (descrição, nome, erro) é dado não confiável: aparado, sem
 * caracteres de controle e com qualquer sequência longa de dígitos mascarada.
 */

export const DIAGNOSTIC_WINDOW_DAYS = 45;
export const DIAGNOSTIC_RECENT = 15;
/** Teto por conta (lançamentos + faturas): uma conta lenta não segura a resposta. */
export const DIAGNOSTIC_ACCOUNT_DEADLINE_MS = 45_000;
/** Posições de investimento detalhadas (e com movimentações consultadas) por conexão; o resto só entra na contagem. */
export const DIAGNOSTIC_INVESTMENTS_MAX = 40;
export const DIAGNOSTIC_INVESTMENT_TX_RECENT = 5;
/** Pedidos de movimentações ao mesmo tempo (o Pluggy tem limite de pedidos). */
const INVESTMENT_TX_CONCURRENCY = 4;
const TEXT_MAX = 120;

const digitsOf = (v: string) => v.replace(/\D/g, "");

/** "•••1234": só os últimos `n` dígitos. `null` se não há dígito. */
export function lastDigits(value: string | null | undefined, n: number): string | null {
	const d = digitsOf(value ?? "");
	return d ? `•••${d.slice(-n)}` : null;
}

/** Texto de terceiro: sem controle, aparado, e sequências de 9+ dígitos mascaradas (datas de 8 dígitos passam). */
export function safeText(value: string | null | undefined, max = TEXT_MAX): string | null {
	if (value === null || value === undefined) return null;
	const clean = value
		.replace(/\p{Cc}/gu, " ")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/\d(?:[\d.\-/ ]*\d)?/g, (run) =>
			digitsOf(run).length >= 9 ? `•••${digitsOf(run).slice(-3)}` : run,
		);
	if (!clean) return null;
	return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

const money = (v: DiagMoney | undefined): DiagMoney => v ?? null;

function toDiagError(e: unknown): DiagError {
	if (e instanceof PluggyError) return { code: e.code, status: e.status ?? null, message: e.message };
	return { code: "unknown", status: null, message: "Falhou ao falar com o Pluggy." };
}

type Participant = NonNullable<NonNullable<PluggyTransaction["paymentData"]>["payer"]>;

function party(p: Participant | null | undefined) {
	if (!p) return null;
	const out: DiagParty = { name: safeText(p.name), documentEnd: lastDigits(p.documentNumber?.value, 3) };
	return out.name || out.documentEnd ? out : null;
}

function toDiagTransaction(t: PluggyTransaction): DiagTransaction {
	const card = t.creditCardMetadata;
	return {
		date: t.date.slice(0, 10),
		description: safeText(t.description ?? t.descriptionRaw),
		amount: money(t.amount),
		type: safeText(t.type, 20) ?? "?",
		status: safeText(t.status, 20),
		category: safeText(t.category),
		installmentNumber: card?.installmentNumber ?? null,
		totalInstallments: card?.totalInstallments ?? null,
		purchaseDate: card?.purchaseDate ? card.purchaseDate.slice(0, 10) : null,
		merchantName: safeText(t.merchant?.name),
		operationType: safeText(t.operationType, 60),
		providerIdStart: t.providerId ? `${t.providerId.slice(0, 8)}` : null,
		billIdStart: card?.billId ? card.billId.slice(0, 8) : null,
		billPostDate: card?.billPostDate ? card.billPostDate.slice(0, 10) : null,
		billForecastDate: card?.billForecastDate ? card.billForecastDate.slice(0, 10) : null,
		paymentType: safeText(card?.paymentType, 60),
		payer: party(t.paymentData?.payer),
		receiver: party(t.paymentData?.receiver),
	};
}

/** Compras menos créditos dos lançamentos PENDING do cartão (a fatura aberta), em R$. `null` se algum valor for ilegível. */
function pendingTotal(list: PluggyTransaction[]): string | null {
	try {
		let sum = 0;
		for (const t of list) {
			if (t.status !== "PENDING") continue;
			const cents = decimalToCents(t.amount);
			sum += t.type === "CREDIT" ? -cents : cents;
		}
		return formatBRL(sum);
	} catch {
		return null;
	}
}

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const late = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() => reject(new PluggyError("timeout", "O Pluggy demorou demais para responder.")),
			ms,
		);
	});
	return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

const day = (d: Date) => d.toISOString().slice(0, 10);

export interface DiagnoseDeps {
	client: PluggyClient;
	now: () => Date;
	/** Qual cartão/conta do Órbita está ligado a esta conta do Pluggy (por `externalId`). */
	linkOf: (account: PluggyAccount) => Promise<DiagLink | null>;
	deadlineMs?: number;
}

/** O que o mapeamento do sync faz com a conta (a MESMA função do sync): "conta", "cartão" ou "descartada: motivo". */
function mappingOf(a: PluggyAccount, connectorName: string | null | undefined): string {
	try {
		const mapped = mapPluggyAccount(a, connectorName);
		if (mapped.kind === "ignored") return `descartada: ${safeText(mapped.reason, 100) ?? "sem motivo"}`;
		return mapped.kind === "card" ? "cartão" : "conta";
	} catch {
		return "descartada: o mapeamento falhou";
	}
}

const KNOWN_ACCOUNT_FIELDS = new Set([
	...Object.keys(accountFields.shape),
	"numberLast4",
	"fieldProblems",
	"itemId",
]);

/** Nomes (só nomes) dos campos preenchidos que o Órbita não lê: mostra o que mais o banco manda. */
function otherAccountFields(a: PluggyAccount): string[] {
	return Object.entries(a as unknown as Record<string, unknown>)
		.filter(([k, v]) => !KNOWN_ACCOUNT_FIELDS.has(k) && v !== null && v !== undefined)
		.map(([k]) => k)
		.filter((k) => /^[A-Za-z0-9_]{1,40}$/.test(k))
		.sort()
		.slice(0, 30);
}

/** Só `campo: código` (letras, números, `_`, `.`, `[]`): nunca o valor. */
function safeProblems(problems: readonly string[] | undefined): string[] {
	return (problems ?? [])
		.filter((p) => /^[A-Za-z0-9_.[\]]{1,60}: (invalid_type|truncated)$/.test(p))
		.slice(0, 20);
}

type AccountDeps = DiagnoseDeps & { connectorName?: string | null };

async function diagnoseAccount(deps: AccountDeps, a: PluggyAccount): Promise<DiagAccount> {
	const { client, now } = deps;
	const to = now();
	const from = new Date(to.getTime() - DIAGNOSTIC_WINDOW_DAYS * 86_400_000);
	const isCredit = a.type === "CREDIT";
	const c = a.creditData;

	const [bills, txs, link] = await Promise.all([
		isCredit
			? client
					.billsRead(a.id)
					.then((r) => ({
						error: null,
						list: r.rows.map(toDiagBill),
						dropped: r.dropped,
						problems: r.problems,
					}))
					.catch((e: unknown) => ({
						error: toDiagError(e),
						list: [] as DiagBill[],
						dropped: 0,
						problems: [] as string[],
					}))
			: Promise.resolve(null),
		client
			.transactions({ accountId: a.id, from: day(from), to: day(to) })
			.then((r) => ({ error: null as DiagError | null, ...r }))
			.catch((e: unknown) => ({
				error: toDiagError(e),
				transactions: [] as PluggyTransaction[],
				dropped: 0,
				problems: [] as string[],
			})),
		deps.linkOf(a).catch(() => null),
	]);

	const count = (s: string) => txs.transactions.filter((t) => t.status === s).length;
	const posted = count("POSTED");
	const pending = count("PENDING");
	const recent = [...txs.transactions]
		.sort((x, y) => y.date.localeCompare(x.date))
		.slice(0, DIAGNOSTIC_RECENT)
		.map(toDiagTransaction);

	return {
		idStart: a.id.slice(0, 8),
		type: safeText(a.type, 40) ?? "?",
		subtype: safeText(a.subtype, 60),
		name: safeText(a.name) ?? "?",
		marketingName: safeText(a.marketingName),
		numberLast4: a.numberLast4 ? `•••${a.numberLast4}` : lastDigits(a.number, 4),
		balance: money(a.balance),
		currencyCode: safeText(a.currencyCode, 10),
		credit: c
			? {
					creditLimit: money(c.creditLimit),
					availableCreditLimit: money(c.availableCreditLimit),
					balanceCloseDate: c.balanceCloseDate?.slice(0, 10) ?? null,
					balanceDueDate: c.balanceDueDate?.slice(0, 10) ?? null,
					minimumPayment: money(c.minimumPayment),
					brand: safeText(c.brand, 60),
					level: safeText(c.level, 60),
				}
			: null,
		link,
		mapping: mappingOf(a, deps.connectorName),
		otherFields: otherAccountFields(a),
		fieldProblems: safeProblems(a.fieldProblems),
		bills,
		transactions: {
			error: txs.error,
			windowDays: DIAGNOSTIC_WINDOW_DAYS,
			posted,
			pending,
			other: txs.transactions.length - posted - pending,
			dropped: txs.dropped,
			problems: txs.problems,
			pendingTotal: isCredit ? pendingTotal(txs.transactions) : null,
			recent,
		},
	};
}

function toDiagBill(b: Awaited<ReturnType<PluggyClient["bills"]>>[number]): DiagBill {
	return {
		dueDate: b.dueDate?.slice(0, 10) ?? null,
		closingDate: b.billClosingDate?.slice(0, 10) ?? null,
		totalAmount: money(b.totalAmount),
		minimumPaymentAmount: money(b.minimumPaymentAmount),
		payments: b.payments.map((p) => ({ date: p.paymentDate.slice(0, 10), amount: money(p.amount) })),
	};
}

const isoDay = (v: string | null | undefined) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

const KNOWN_INVESTMENT_FIELDS = new Set([...Object.keys(investmentSchema.shape), "itemId"]);

/** Nomes (só nomes) dos campos preenchidos que o schema não conhece: mostra o que mais o Pluggy manda. */
function otherFieldsOf(i: PluggyInvestment): string[] {
	return Object.entries(i)
		.filter(([k, v]) => !KNOWN_INVESTMENT_FIELDS.has(k) && v !== null && v !== undefined)
		.map(([k]) => k)
		.filter((k) => /^[A-Za-z0-9_]{1,40}$/.test(k))
		.sort()
		.slice(0, 30);
}

function readError(r: Exclude<InvestmentsRead<unknown>, { outcome: "ok" }>): DiagError {
	return { code: r.code, status: r.status, message: r.message };
}

function toDiagInvestmentTransaction(t: PluggyInvestmentTransaction): DiagInvestmentTransaction {
	return {
		date: isoDay(t.date) ?? isoDay(t.tradeDate),
		type: safeText(t.type, 40),
		movementType: safeText(t.movementType, 20),
		amount: money(t.amount),
		quantity: money(t.quantity),
		value: money(t.value),
		description: safeText(t.description),
	};
}

function toDiagInvestmentTransactions(
	r: InvestmentsRead<PluggyInvestmentTransaction>,
): NonNullable<DiagInvestment["transactions"]> {
	if (r.outcome !== "ok") {
		return {
			outcome: r.outcome,
			error: readError(r),
			count: 0,
			dropped: 0,
			firstDate: null,
			lastDate: null,
			byType: [],
			recent: [],
		};
	}
	const rows = r.rows.map(toDiagInvestmentTransaction);
	const days = rows.flatMap((x) => (x.date ? [x.date] : [])).sort();
	const types = new Map<string, number>();
	for (const x of rows) types.set(x.type ?? "?", (types.get(x.type ?? "?") ?? 0) + 1);
	return {
		outcome: "ok",
		error: null,
		count: rows.length,
		dropped: r.dropped,
		firstDate: days[0] ?? null,
		lastDate: days.at(-1) ?? null,
		byType: [...types].map(([type, count]) => ({ type, count })).sort((a, b) => a.type.localeCompare(b.type)),
		recent: [...rows]
			.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
			.slice(0, DIAGNOSTIC_INVESTMENT_TX_RECENT),
	};
}

function toDiagInvestment(i: PluggyInvestment, transactions: DiagInvestment["transactions"]): DiagInvestment {
	return {
		idStart: i.id.slice(0, 8),
		type: safeText(i.type, 40),
		subtype: safeText(i.subtype, 60),
		name: safeText(i.name),
		code: safeText(i.code, 60),
		isin: safeText(i.isin, 20),
		currencyCode: safeText(i.currencyCode, 10),
		balance: money(i.balance),
		amount: money(i.amount),
		amountOriginal: money(i.amountOriginal),
		amountProfit: money(i.amountProfit),
		amountWithdrawal: money(i.amountWithdrawal),
		taxes: money(i.taxes),
		taxes2: money(i.taxes2),
		quantity: money(i.quantity),
		value: money(i.value),
		rate: money(i.rate),
		rateType: safeText(i.rateType, 20),
		fixedAnnualRate: money(i.fixedAnnualRate),
		annualRate: money(i.annualRate),
		lastMonthRate: money(i.lastMonthRate),
		lastTwelveMonthsRate: money(i.lastTwelveMonthsRate),
		date: isoDay(i.date),
		dueDate: isoDay(i.dueDate),
		issueDate: isoDay(i.issueDate),
		purchaseDate: isoDay(i.purchaseDate),
		status: safeText(i.status, 40),
		issuer: safeText(i.issuer),
		institutionName: safeText(i.institution?.name),
		otherFields: otherFieldsOf(i),
		transactions,
	};
}

/** Soma dos saldos em BRL (centavos inteiros), formatada. `null` se nenhum saldo é legível. */
function balanceTotal(list: PluggyInvestment[]): string | null {
	let sum = 0;
	let any = false;
	for (const i of list) {
		if (i.currencyCode && i.currencyCode !== "BRL") continue;
		const cents = toInvestmentPosition(i).balanceCents;
		if (cents === null) continue;
		sum += cents;
		any = true;
	}
	return any && Number.isSafeInteger(sum) ? formatBRL(sum) : null;
}

async function inPool<T, R>(items: T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
	const out = new Array<R>(items.length);
	let next = 0;
	const runner = async () => {
		for (;;) {
			const index = next++;
			if (index >= items.length) return;
			out[index] = await work(items[index] as T);
		}
	};
	await Promise.all(Array.from({ length: Math.min(size, items.length) }, runner));
	return out;
}

/**
 * Investimentos da conexão, ao vivo e só leitura: nada é gravado. Nunca lança: recusa do endpoint (403/404) vira
 * "unavailable", outra falha vira "error", e falha das movimentações de uma posição fica só nela. O motivo de não
 * vir nada é só o OBSERVADO (endpoint vazio, recusado, erro) mais o que o item diz (produtos pedidos, avisos,
 * autorização vencida).
 */
async function diagnoseInvestments(deps: DiagnoseDeps, item: PluggyItem): Promise<DiagInvestments> {
	const now = deps.now().getTime();
	const until = now + (deps.deadlineMs ?? DIAGNOSTIC_ACCOUNT_DEADLINE_MS);
	const products = item.products?.map((p) => p.toUpperCase()) ?? null;
	const expires = item.consentExpiresAt ? Date.parse(item.consentExpiresAt) : Number.NaN;
	const base: DiagInvestments = {
		outcome: "empty",
		error: null,
		count: 0,
		dropped: 0,
		balanceTotal: null,
		productRequested: products ? products.includes("INVESTMENTS") : null,
		transactionsProductRequested: products ? products.includes("INVESTMENTS_TRANSACTIONS") : null,
		consentExpired: Number.isFinite(expires) ? expires < now : null,
		warnings: Object.entries(item.statusDetail ?? {})
			.filter(([name]) => name.toLowerCase().startsWith("investment"))
			.flatMap(([name, d]) =>
				(d?.warnings ?? []).map(
					(w) =>
						`${safeText(name, 60) ?? "?"} ${safeText(w.code === null || w.code === undefined ? null : String(w.code), 60) ?? "?"}: ${safeText(w.message, 200) ?? ""}`,
				),
			)
			.slice(0, 20),
		positions: [],
		transactionsCount: 0,
		transactionsFirstDate: null,
		transactionsLastDate: null,
	};
	const read = await withDeadline(readInvestments(deps.client, item.id), until - now).catch(
		(): InvestmentsRead<PluggyInvestment> => {
			const e = pluggyError("timeout");
			return { outcome: "error", code: e.code, status: null, message: e.message };
		},
	);
	if (read.outcome !== "ok") return { ...base, outcome: read.outcome, error: readError(read) };
	base.count = read.rows.length;
	base.dropped = read.dropped;
	if (read.rows.length === 0) return base;
	base.outcome = "ok";
	base.balanceTotal = balanceTotal(read.rows);
	const shown = read.rows.slice(0, DIAGNOSTIC_INVESTMENTS_MAX);
	base.positions = await inPool(shown, INVESTMENT_TX_CONCURRENCY, async (i) => {
		const left = until - deps.now().getTime();
		const late = (): InvestmentsRead<PluggyInvestmentTransaction> => {
			const e = pluggyError("timeout");
			return { outcome: "error", code: e.code, status: null, message: e.message };
		};
		const txs =
			left <= 0
				? late()
				: await withDeadline(readInvestmentTransactions(deps.client, i.id), left).catch(late);
		return toDiagInvestment(i, toDiagInvestmentTransactions(txs));
	});
	const days: string[] = [];
	for (const p of base.positions) {
		base.transactionsCount += p.transactions?.count ?? 0;
		if (p.transactions?.firstDate) days.push(p.transactions.firstDate);
		if (p.transactions?.lastDate) days.push(p.transactions.lastDate);
	}
	days.sort();
	base.transactionsFirstDate = days[0] ?? null;
	base.transactionsLastDate = days.at(-1) ?? null;
	return base;
}

/**
 * Uma conexão, ao vivo. Falha do item ou das contas vira `error` da conexão; falha de uma conta (timeout, `/bills`
 * 404…) vira erro só daquela conta. Nunca lança.
 */
export async function diagnoseConnection(
	deps: DiagnoseDeps,
	connection: {
		id: string;
		label: string | null;
		lastStatus?: string | null;
		lastError?: string | null;
		lastSyncAt?: Date | null;
		accountCount?: number;
		cardCount?: number;
	},
): Promise<DiagConnection> {
	const base: DiagConnection = {
		label: safeText(connection.label, 60),
		itemIdStart: connection.id.slice(0, 8),
		connectorName: null,
		status: null,
		executionStatus: null,
		lastUpdatedAt: null,
		connectorIsOpenFinance: null,
		connectorType: null,
		nextAutoSyncAt: null,
		consentExpiresAt: null,
		products: [],
		itemError: null,
		createdAt: null,
		requestedProducts: null,
		accountsRaw: null,
		accountsMappable: null,
		accountsImported: null,
		accountsRejected: null,
		accountProblems: [],
		lastSync:
			connection.lastStatus === undefined
				? null
				: {
						status: connection.lastStatus,
						error: safeText(connection.lastError, 300),
						at: connection.lastSyncAt?.toISOString() ?? null,
						accounts: connection.accountCount ?? 0,
						cards: connection.cardCount ?? 0,
					},
		error: null,
		accounts: [],
		investments: null,
	};
	let connectorName: string | null = null;
	let investments: Promise<DiagInvestments | null>;
	try {
		const item = await deps.client.item(connection.id);
		// Em paralelo com as contas; nunca rejeita (qualquer surpresa vira "não consultado").
		investments = diagnoseInvestments(deps, item).catch(() => null);
		base.connectorName = safeText(item.connector?.name);
		connectorName = item.connector?.name ?? null;
		base.createdAt = item.createdAt ?? null;
		base.requestedProducts = item.products
			? item.products.slice(0, 30).map((p) => safeText(p, 60) ?? "?")
			: null;
		base.status = safeText(item.status, 60);
		base.executionStatus = safeText(item.executionStatus, 60);
		base.lastUpdatedAt = item.lastUpdatedAt ?? null;
		base.connectorIsOpenFinance = item.connector?.isOpenFinance ?? null;
		base.connectorType = safeText(item.connector?.type, 60);
		base.nextAutoSyncAt = item.nextAutoSyncAt ?? null;
		base.consentExpiresAt = item.consentExpiresAt ?? null;
		base.products = Object.entries(item.statusDetail ?? {})
			.slice(0, 20)
			.map(([name, d]) => ({
				name: safeText(name, 60) ?? "?",
				isUpdated: d?.isUpdated ?? null,
				lastUpdatedAt: d?.lastUpdatedAt ?? null,
				warnings: (d?.warnings ?? []).map(
					(w) =>
						`${safeText(w.code === null || w.code === undefined ? null : String(w.code), 60) ?? "?"}: ${safeText(w.message, 200) ?? ""}`,
				),
			}));
		if (item.error) {
			base.itemError = { code: safeText(item.error.code, 100), message: safeText(item.error.message, 300) };
		}
	} catch (e) {
		base.error = toDiagError(e);
		return base;
	}
	let accounts: PluggyAccount[];
	try {
		const read = await deps.client.accountsRead(connection.id);
		accounts = read.rows;
		base.accountsRejected = read.dropped;
		base.accountProblems = read.problems;
	} catch (e) {
		base.error = toDiagError(e);
		base.investments = await investments;
		return base;
	}
	const ms = deps.deadlineMs ?? DIAGNOSTIC_ACCOUNT_DEADLINE_MS;
	base.accountsRaw = accounts.length + (base.accountsRejected ?? 0);
	base.accounts = await Promise.all(
		accounts.map((a) =>
			withDeadline(diagnoseAccount({ ...deps, connectorName }, a), ms).catch(
				(e: unknown): DiagAccount => ({
					idStart: a.id.slice(0, 8),
					type: safeText(a.type, 40) ?? "?",
					subtype: safeText(a.subtype, 60),
					name: safeText(a.name) ?? "?",
					marketingName: null,
					numberLast4: lastDigits(a.number, 4),
					balance: null,
					currencyCode: null,
					credit: null,
					link: null,
					mapping: mappingOf(a, connectorName),
					bills: null,
					transactions: {
						error: toDiagError(e),
						windowDays: DIAGNOSTIC_WINDOW_DAYS,
						posted: 0,
						pending: 0,
						other: 0,
						dropped: 0,
						pendingTotal: null,
						recent: [],
					},
				}),
			),
		),
	);
	base.accountsMappable = base.accounts.filter((a) => !a.mapping?.startsWith("descartada")).length;
	base.accountsImported = base.accounts.filter((a) => a.link !== null).length;
	base.investments = await investments;
	return base;
}
