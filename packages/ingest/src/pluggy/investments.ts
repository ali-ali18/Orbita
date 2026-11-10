import { type Cents, decimalToCents } from "@orbita/core";
import type { PluggyClient } from "./client.ts";
import { PluggyError, type PluggyErrorCode } from "./errors.ts";
import type { PluggyInvestment, PluggyInvestmentTransaction } from "./schemas.ts";

/*
 * Investimentos do Pluggy na BORDA: o JSON traz reais em float; daqui para dentro só centavos inteiros
 * (`decimalToCents`, nunca `* 100`) e decimais em texto (cota, quantidade, taxa). Nada aqui grava: a Fase 0 só lê
 * (diagnóstico). O que a doc promete e o que não se pode assumir está em docs/pluggy.md, "Investimentos".
 */

/** Centavos, ou `null` se o campo não veio ou é ilegível (ausente NUNCA vira zero). */
export function centsOrNull(value: number | string | null | undefined): Cents | null {
	if (value === null || value === undefined) return null;
	try {
		return decimalToCents(value);
	} catch {
		return null;
	}
}

/**
 * Decimal que não é dinheiro (quantidade de cotas, valor da cota, taxa) como texto canônico, sem notação científica
 * e sem zeros sobrando: `1.2500` → "1.25", `3` → "3". Até 8 casas (a cota de fundo costuma ter 6 a 8). `null` se
 * ausente ou ilegível. Quem precisar fazer conta com isso usa aritmética decimal, não float.
 */
export function decimalText(value: number | string | null | undefined): string | null {
	if (value === null || value === undefined) return null;
	let text: string;
	if (typeof value === "number") {
		if (!Number.isFinite(value) || Math.abs(value) >= 1e15) return null;
		text = value.toFixed(8);
	} else if (/^-?\d{1,15}(\.\d+)?$/.test(value.trim())) {
		text = value.trim();
	} else {
		return null;
	}
	const [whole = "0", fraction = ""] = text.split(".");
	const trimmed = fraction.slice(0, 8).replace(/0+$/, "");
	const out = trimmed ? `${whole}.${trimmed}` : whole;
	return /^-0(\.0*)?$/.test(out) ? "0" : out;
}

const dayOf = (v: string | null | undefined) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

/** Posição de investimento já normalizada (centavos inteiros; decimais em texto; datas "AAAA-MM-DD"). */
export interface InvestmentPosition {
	externalId: string;
	type: string | null;
	subtype: string | null;
	name: string | null;
	code: string | null;
	isin: string | null;
	currencyCode: string | null;
	/** Saldo líquido atual. */
	balanceCents: Cents | null;
	/** Valor bruto. */
	grossCents: Cents | null;
	/** Valor aplicado. */
	investedCents: Cents | null;
	/** Rendimento líquido informado pelo banco (negativo = perda). `null` = o banco não informou: NÃO calcular por conta. */
	profitCents: Cents | null;
	withdrawableCents: Cents | null;
	incomeTaxCents: Cents | null;
	financialTaxCents: Cents | null;
	quantity: string | null;
	unitValue: string | null;
	rate: string | null;
	rateType: string | null;
	fixedAnnualRate: string | null;
	annualRate: string | null;
	lastMonthRate: string | null;
	lastTwelveMonthsRate: string | null;
	/** Data de referência do valor (a "data da posição"). */
	date: string | null;
	dueDate: string | null;
	issueDate: string | null;
	purchaseDate: string | null;
	issuer: string | null;
	status: string | null;
	institutionName: string | null;
}

export function toInvestmentPosition(i: PluggyInvestment): InvestmentPosition {
	return {
		externalId: i.id,
		type: i.type ?? null,
		subtype: i.subtype ?? null,
		name: i.name ?? null,
		code: i.code ?? null,
		isin: i.isin ?? null,
		currencyCode: i.currencyCode ?? null,
		balanceCents: centsOrNull(i.balance),
		grossCents: centsOrNull(i.amount),
		investedCents: centsOrNull(i.amountOriginal),
		profitCents: centsOrNull(i.amountProfit),
		withdrawableCents: centsOrNull(i.amountWithdrawal),
		incomeTaxCents: centsOrNull(i.taxes),
		financialTaxCents: centsOrNull(i.taxes2),
		quantity: decimalText(i.quantity),
		unitValue: decimalText(i.value),
		rate: decimalText(i.rate),
		rateType: i.rateType ?? null,
		fixedAnnualRate: decimalText(i.fixedAnnualRate),
		annualRate: decimalText(i.annualRate),
		lastMonthRate: decimalText(i.lastMonthRate),
		lastTwelveMonthsRate: decimalText(i.lastTwelveMonthsRate),
		date: dayOf(i.date),
		dueDate: dayOf(i.dueDate),
		issueDate: dayOf(i.issueDate),
		purchaseDate: dayOf(i.purchaseDate),
		issuer: i.issuer ?? null,
		status: i.status ?? null,
		institutionName: i.institution?.name ?? null,
	};
}

/** Movimentação normalizada. `amountCents` é o valor bruto da operação, em magnitude (sem sinal): o sentido está em `type`/`movementType`. */
export interface InvestmentMovement {
	externalId: string;
	type: string | null;
	movementType: string | null;
	date: string | null;
	tradeDate: string | null;
	description: string | null;
	quantity: string | null;
	unitValue: string | null;
	amountCents: Cents | null;
	netAmountCents: Cents | null;
}

/** Algumas fontes mandam o SELL com valor negativo: o valor guardado é a magnitude e o sentido vem de `type`. */
const magnitude = (cents: Cents | null): Cents | null => (cents === null ? null : Math.abs(cents));

export function toInvestmentMovement(t: PluggyInvestmentTransaction): InvestmentMovement {
	return {
		externalId: t.id,
		type: t.type ?? null,
		movementType: t.movementType ?? null,
		date: dayOf(t.date),
		tradeDate: dayOf(t.tradeDate),
		description: t.description ?? null,
		quantity: decimalText(t.quantity),
		unitValue: decimalText(t.value),
		amountCents: magnitude(centsOrNull(t.amount)),
		netAmountCents: magnitude(centsOrNull(t.netAmount)),
	};
}

/**
 * Leitura que nunca lança. `unavailable`: o endpoint recusou com 403 ou 404 (o conector/plano não entrega o
 * produto): é "não disponível", não falha da rodada. `error`: o resto (rede, timeout, 5xx, formato), para tentar depois.
 */
export type InvestmentsRead<T> =
	| { outcome: "ok"; rows: T[]; dropped: number }
	| { outcome: "unavailable"; code: PluggyErrorCode; status: number | null; message: string }
	| { outcome: "error"; code: PluggyErrorCode | "unknown"; status: number | null; message: string };

const UNAVAILABLE = "O Pluggy não entrega investimentos para esta conexão.";

function failed<T>(e: unknown): InvestmentsRead<T> {
	if (!(e instanceof PluggyError)) {
		return { outcome: "error", code: "unknown", status: null, message: "Falhou ao falar com o Pluggy." };
	}
	const status = e.status ?? null;
	if (e.code === "forbidden" || e.code === "not_found") {
		return { outcome: "unavailable", code: e.code, status, message: UNAVAILABLE };
	}
	return { outcome: "error", code: e.code, status, message: e.message };
}

type InvestmentsClient = Pick<PluggyClient, "investments" | "investmentTransactions">;

/** Posições de uma conexão. Lista vazia é `ok` com zero linhas. */
export async function readInvestments(
	client: InvestmentsClient,
	itemId: string,
): Promise<InvestmentsRead<PluggyInvestment>> {
	try {
		const r = await client.investments(itemId);
		return { outcome: "ok", rows: r.investments, dropped: r.dropped };
	} catch (e) {
		return failed(e);
	}
}

/** Movimentações de uma posição. */
export async function readInvestmentTransactions(
	client: InvestmentsClient,
	investmentId: string,
): Promise<InvestmentsRead<PluggyInvestmentTransaction>> {
	try {
		const r = await client.investmentTransactions(investmentId);
		return { outcome: "ok", rows: r.transactions, dropped: r.dropped };
	} catch (e) {
		return failed(e);
	}
}
