import { decimalToCents, formatBRL } from "@orbita/core";
import type {
	DiagAccount,
	DiagBill,
	DiagConnection,
	DiagError,
	DiagLink,
	DiagMoney,
	DiagParty,
	DiagTransaction,
} from "@orbita/shared";
import type { PluggyClient } from "./client.ts";
import { PluggyError } from "./errors.ts";
import type { PluggyAccount, PluggyTransaction } from "./schemas.ts";

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

async function diagnoseAccount(deps: DiagnoseDeps, a: PluggyAccount): Promise<DiagAccount> {
	const { client, now } = deps;
	const to = now();
	const from = new Date(to.getTime() - DIAGNOSTIC_WINDOW_DAYS * 86_400_000);
	const isCredit = a.type === "CREDIT";
	const c = a.creditData;

	const [bills, txs, link] = await Promise.all([
		isCredit
			? client
					.bills(a.id)
					.then((list) => ({ error: null, list: list.map(toDiagBill) }))
					.catch((e: unknown) => ({ error: toDiagError(e), list: [] as DiagBill[] }))
			: Promise.resolve(null),
		client
			.transactions({ accountId: a.id, from: day(from), to: day(to) })
			.then((r) => ({ error: null as DiagError | null, ...r }))
			.catch((e: unknown) => ({
				error: toDiagError(e),
				transactions: [] as PluggyTransaction[],
				dropped: 0,
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
		numberLast4: lastDigits(a.number, 4),
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
		bills,
		transactions: {
			error: txs.error,
			windowDays: DIAGNOSTIC_WINDOW_DAYS,
			posted,
			pending,
			other: txs.transactions.length - posted - pending,
			dropped: txs.dropped,
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

/**
 * Uma conexão, ao vivo. Falha do item ou das contas vira `error` da conexão; falha de uma conta (timeout, `/bills`
 * 404…) vira erro só daquela conta. Nunca lança.
 */
export async function diagnoseConnection(
	deps: DiagnoseDeps,
	connection: { id: string; label: string | null },
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
		error: null,
		accounts: [],
	};
	try {
		const item = await deps.client.item(connection.id);
		base.connectorName = safeText(item.connector?.name);
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
		accounts = await deps.client.accounts(connection.id);
	} catch (e) {
		base.error = toDiagError(e);
		return base;
	}
	const ms = deps.deadlineMs ?? DIAGNOSTIC_ACCOUNT_DEADLINE_MS;
	base.accounts = await Promise.all(
		accounts.map((a) =>
			withDeadline(diagnoseAccount(deps, a), ms).catch(
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
	return base;
}
