import type { LocalDate } from "@orbita/core";
import type { TransactionSource } from "@orbita/shared";

/** Um pagamento feito na fatura, como o banco informou (`payments[]` da Pluggy). */
export interface BillPaymentRecord {
	/** Id do pagamento no banco, quando informa. */
	externalId: string | null;
	amountCents: number;
	date: LocalDate;
}

/** Fatura do cartão como o banco a informou. Só a sincronização grava; o dono não edita. */
export interface BillRecord {
	id: string;
	cardId: string;
	/** Origem da fatura (hoje "pluggy"); com `externalId`, é a identidade dela. */
	source: TransactionSource;
	externalId: string;
	/** Dia do fechamento, quando o banco informa. */
	closeDate: LocalDate | null;
	/** Dia do vencimento: o mês dele é o mês da fatura. */
	dueDate: LocalDate;
	totalAmountCents: number;
	/** Pagamento mínimo, quando o banco informa. */
	minimumPaymentCents: number | null;
	currency: string;
	/** Pagamentos feitos nesta fatura, por data. */
	payments: BillPaymentRecord[];
	/** Quando a sincronização gravou esta fatura pela última vez. */
	syncedAt: Date;
}

export interface BillInput {
	cardId: string;
	/** Exige origem diferente de "manual" (a fatura é sempre de fora). */
	source: TransactionSource;
	externalId: string;
	closeDate?: LocalDate | null;
	dueDate: LocalDate;
	totalAmountCents: number;
	minimumPaymentCents?: number | null;
	/** Padrão: "BRL". */
	currency?: string;
	/** Substitui os pagamentos gravados (a lista do banco é a verdade). */
	payments?: BillPaymentRecord[];
	syncedAt: Date;
}

export interface BillStore {
	/**
	 * Grava a fatura, idempotente por (`source`, `externalId`): repetir atualiza em vez de duplicar e os pagamentos
	 * passam a ser exatamente os informados. `bad_reference` se o cartão não existe; `invalid` para valor ou data ruim.
	 */
	upsert(input: BillInput): Promise<BillRecord>;
	get(id: string): Promise<BillRecord | null>;
	findByExternal(source: TransactionSource, externalId: string): Promise<BillRecord | null>;
	/** Faturas de um cartão, da de vencimento mais recente para a mais antiga. */
	listByCard(cardId: string): Promise<BillRecord[]>;
	/** Todas as faturas, da de vencimento mais recente para a mais antiga. */
	list(): Promise<BillRecord[]>;
}
