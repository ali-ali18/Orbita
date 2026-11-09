import { decimalToCents } from "@orbita/core";
import { DataError, type Stores } from "@orbita/db";
import { MAX_CENTS } from "@orbita/shared";
import { PLUGGY_SOURCE, pluggyDateToLocal } from "./mapping.ts";
import type { PluggyAccount, PluggyBill } from "./schemas.ts";

/*
 * Os números que o banco já entrega (saldo da conta, limite disponível do cartão, faturas): lidos do Pluggy e
 * gravados como vieram, em centavos inteiros. Tudo aqui é dado de fora: valor estranho vira "ausente" e ausente
 * mantém o último valor gravado (nunca zera). Nenhuma conta é feita aqui; quem lê usa o número como está.
 */

/** Centavos com sinal (saldo pode ser negativo) ou `null` se ausente, ilegível ou grande demais. */
export function signedCentsOrNull(value: number | string | null | undefined): number | null {
	if (value === null || value === undefined) return null;
	try {
		const cents = decimalToCents(value);
		return Math.abs(cents) <= MAX_CENTS ? cents : null;
	} catch {
		return null;
	}
}

/** Um cadastro do Órbita ligado a uma conta do Pluggy (o que `linkAccounts` devolve, só o que importa aqui). */
export interface LinkedTarget {
	pluggyId: string;
	account: { id: string; archivedAt: Date | null } | null;
	card: { id: string; archivedAt: Date | null } | null;
}

export interface BankNumbersResult {
	balances: number;
	limits: number;
	bills: number;
	/** Faturas que não deu para gravar (sem vencimento ou total, outra moeda, dado recusado). */
	skippedBills: number;
}

/**
 * Grava, a cada sincronização, o saldo de cada conta BANK e o limite disponível de cada cartão, com `at` (o
 * `now()` injetado) como instante da leitura. Campo ausente no Pluggy não grava nada: fica o último valor.
 */
export async function recordBankNumbers(
	stores: Pick<Stores, "accounts" | "cards">,
	pluggyAccounts: readonly PluggyAccount[],
	linked: readonly LinkedTarget[],
	at: Date,
	result: BankNumbersResult,
): Promise<void> {
	const byPluggyId = new Map(pluggyAccounts.map((pa) => [pa.id, pa]));
	for (const target of linked) {
		const pa = byPluggyId.get(target.pluggyId);
		if (!pa) continue;
		if (target.account && target.account.archivedAt === null && pa.type === "BANK") {
			const balance = signedCentsOrNull(pa.balance);
			if (balance !== null) {
				await stores.accounts.recordBalance(target.account.id, balance, at);
				result.balances += 1;
			}
		}
		if (target.card && target.card.archivedAt === null && pa.type === "CREDIT") {
			const available = signedCentsOrNull(pa.creditData?.availableCreditLimit);
			if (available !== null) {
				await stores.cards.recordAvailable(target.card.id, available, at);
				result.limits += 1;
			}
		}
	}
}

/**
 * Grava as faturas que o Pluggy devolveu para cada cartão ligado, com os pagamentos de cada uma. Idempotente por
 * (origem, id da fatura): repetir só atualiza. Fatura sem vencimento válido, sem total ou em outra moeda fica de
 * fora; falha de uma fatura (dado recusado) não impede as outras. Nunca apaga: se o Pluggy não devolveu faturas
 * (falha, conector sem faturas), as gravadas continuam como estavam.
 */
export async function recordBills(
	stores: Pick<Stores, "bills">,
	billsOf: ReadonlyMap<string, { bills: readonly PluggyBill[] }>,
	linked: readonly LinkedTarget[],
	at: Date,
	result: BankNumbersResult,
): Promise<void> {
	for (const target of linked) {
		if (!target.card || target.card.archivedAt !== null) continue;
		for (const bill of billsOf.get(target.pluggyId)?.bills ?? []) {
			const dueDate = bill.dueDate ? pluggyDateToLocal(bill.dueDate) : null;
			const total = signedCentsOrNull(bill.totalAmount);
			const foreign = bill.totalAmountCurrencyCode && bill.totalAmountCurrencyCode !== "BRL";
			if (dueDate === null || total === null || foreign) {
				result.skippedBills += 1;
				continue;
			}
			const payments = bill.payments.flatMap((p) => {
				const date = pluggyDateToLocal(p.paymentDate);
				const amountCents = signedCentsOrNull(p.amount);
				if (date === null || amountCents === null || (p.currencyCode && p.currencyCode !== "BRL")) return [];
				return [{ externalId: p.id ?? null, amountCents, date }];
			});
			try {
				await stores.bills.upsert({
					cardId: target.card.id,
					source: PLUGGY_SOURCE,
					externalId: bill.id,
					closeDate: bill.billClosingDate ? pluggyDateToLocal(bill.billClosingDate) : null,
					dueDate,
					totalAmountCents: total,
					minimumPaymentCents: signedCentsOrNull(bill.minimumPaymentAmount),
					payments,
					syncedAt: at,
				});
				result.bills += 1;
			} catch (e) {
				if (!(e instanceof DataError)) throw e;
				result.skippedBills += 1;
			}
		}
	}
}
