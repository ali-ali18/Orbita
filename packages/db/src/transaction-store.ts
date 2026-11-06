import type { Installment, LocalDate, MonthKey } from "@orbita/core";
import type { TransactionKindValue, TransactionSource, TransactionStatus } from "@orbita/shared";

/** Todos os campos de um lançamento (sem id e sem datas de controle). */
export interface TransactionData {
	kind: TransactionKindValue;
	/** Sempre positivo; o sentido vem de `kind`. */
	amountCents: number;
	date: LocalDate;
	description: string;
	categoryId: string | null;
	accountId: string | null;
	cardId: string | null;
	/** Destino de uma transferência. */
	counterpartAccountId: string | null;
	/** Despesa original de um estorno. */
	refundOfId: string | null;
	budgetMonth: MonthKey;
	/** Só compra/estorno no cartão. */
	invoiceMonth: MonthKey | null;
	installmentGroupId: string | null;
	installmentNumber: number | null;
	installmentCount: number | null;
	status: TransactionStatus;
	source: TransactionSource;
	externalId: string | null;
	note: string | null;
}

export interface TransactionRecord extends TransactionData {
	id: string;
	createdAt: Date;
	updatedAt: Date;
}

export interface TransactionInput {
	kind: TransactionKindValue;
	amountCents: number;
	date: LocalDate;
	description: string;
	categoryId?: string | null;
	accountId?: string | null;
	cardId?: string | null;
	counterpartAccountId?: string | null;
	refundOfId?: string | null;
	/** Padrão: o mês de `date`. Parcelas informam o seu (ver `installmentSchedule`). */
	budgetMonth?: MonthKey | null;
	invoiceMonth?: MonthKey | null;
	installmentGroupId?: string | null;
	installmentNumber?: number | null;
	installmentCount?: number | null;
	/** Padrão: "confirmed". */
	status?: TransactionStatus;
	/** Padrão: "manual". */
	source?: TransactionSource;
	externalId?: string | null;
	note?: string | null;
}

/** Item de um parcelamento: o grupo é criado pelo store; número e total são obrigatórios. */
export type InstallmentInput = Omit<TransactionInput, "installmentGroupId"> & {
	installmentNumber: number;
	installmentCount: number;
};

/** Campos editáveis. Origem, id externo e parcelamento são a identidade do lançamento e não mudam. */
export type TransactionPatch = Partial<
	Omit<
		TransactionData,
		"source" | "externalId" | "installmentGroupId" | "installmentNumber" | "installmentCount"
	>
>;

export type UpsertByExternalInput = Omit<TransactionInput, "source" | "externalId">;

export type UpsertResult =
	| { created: true; transaction: TransactionRecord }
	/**
	 * Já existia. `transaction` é `null` quando o usuário apagou o lançamento: a ingestão
	 * deve ignorar, não recriar.
	 */
	| { created: false; transaction: TransactionRecord | null };

export interface TransactionCursor {
	date: LocalDate;
	id: string;
}

export interface InstallmentGroupRecord {
	groupId: string;
	/** Todas as parcelas do grupo que existem, por número. */
	installments: TransactionRecord[];
}

/** Para `remainingInstallments` e `installmentSchedule` do engine. */
export function toInstallment(t: TransactionRecord): Installment {
	if (t.installmentNumber === null || t.installmentCount === null || t.invoiceMonth === null) {
		throw new RangeError(`lançamento ${t.id} não é uma parcela de cartão`);
	}
	return {
		number: t.installmentNumber,
		count: t.installmentCount,
		amountCents: t.amountCents,
		invoiceMonth: t.invoiceMonth,
		budgetMonth: t.budgetMonth,
	};
}

/**
 * Lançamentos apagados (`softDelete`) nunca voltam de `get` nem das listas. Todo método que
 * grava valida as invariantes (ver `transactionInvariantError` em `@orbita/shared`) e lança
 * `DataError` com a mesma mensagem nas duas implementações.
 */
export interface TransactionStore {
	create(input: TransactionInput): Promise<TransactionRecord>;
	/** Tudo ou nada. Número e total devem bater; o `installmentGroupId` é gerado aqui. */
	createInstallmentGroup(inputs: readonly InstallmentInput[]): Promise<TransactionRecord[]>;
	/** Idempotente por (source, externalId): repetir devolve o que já existe. */
	upsertByExternal(
		source: TransactionSource,
		externalId: string,
		input: UpsertByExternalInput,
	): Promise<UpsertResult>;
	/** Valida o lançamento inteiro depois do patch. `not_found` se não existe ou foi apagado. */
	update(id: string, patch: TransactionPatch): Promise<TransactionRecord>;
	/** `true` se apagou agora, `false` se não existia ou já estava apagado. */
	softDelete(id: string): Promise<boolean>;
	/** Apaga todas as parcelas do grupo. Devolve quantas. */
	softDeleteGroup(groupId: string): Promise<number>;
	get(id: string): Promise<TransactionRecord | null>;
	/** Por data, depois por criação. */
	listByBudgetMonth(month: MonthKey): Promise<TransactionRecord[]>;
	listByInvoice(cardId: string, invoiceMonth: MonthKey): Promise<TransactionRecord[]>;
	/** Os que esperam revisão, do mais recente para o mais antigo. */
	listPending(): Promise<TransactionRecord[]>;
	/** Do mais recente para o mais antigo (data, id). `before` é o último item da página anterior. */
	listRecent(options: { limit: number; before?: TransactionCursor }): Promise<TransactionRecord[]>;
	/**
	 * Parcelamentos ainda em andamento: com alguma parcela cuja fatura (ou mês do orçamento,
	 * se não for de cartão) é `activeFromMonth` ou depois. Devolve o grupo inteiro, por data.
	 */
	listInstallmentGroups(activeFromMonth: MonthKey): Promise<InstallmentGroupRecord[]>;
}
