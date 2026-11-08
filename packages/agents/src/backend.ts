import type {
	MonthSummaryResponse,
	RecurrenceDto,
	TransactionApiCreateBody,
	TransactionDto,
	TransactionKindValue,
	TransactionStatus,
} from "@orbita/shared";

/*
 * O que as ferramentas precisam do resto do sistema, como portas pequenas. O servidor implementa estas portas
 * em cima das stores e do engine (`apps/api/src/modules/chat/backend.ts`); os testes usam versões em memória.
 * Nada aqui conhece banco, rede ou relógio.
 */

export interface Catalog {
	categories: Array<{ id: string; name: string; slug: string }>;
	accounts: Array<{ id: string; name: string; kind: string }>;
	cards: Array<{ id: string; name: string; last4: string | null; closingDay: number; dueDay: number }>;
	/** Conta que o dono marcou como padrão do Novo lançamento. */
	defaultAccountId: string | null;
}

export interface TransactionQuery {
	from?: string | undefined;
	to?: string | undefined;
	kinds?: readonly TransactionKindValue[] | undefined;
	accountIds?: readonly string[] | undefined;
	cardIds?: readonly string[] | undefined;
	categoryIds?: readonly string[] | undefined;
	statuses?: readonly TransactionStatus[] | undefined;
	minCents?: number | undefined;
	maxCents?: number | undefined;
	limit: number;
	cursor?: string | undefined;
}

export interface InvoiceData {
	card: { id: string; name: string };
	month: string;
	closingDate: string;
	dueDate: string;
	/** `open`, `closed` ou `overdue` (do engine). */
	status: string;
	/** `open`, `unpaid`, `partial` ou `paid` (do engine). */
	paymentStatus: string;
	paidCents: number;
	composition: {
		purchasesCents: number;
		installmentsCents: number;
		recurringCents: number;
		refundsCents: number;
		totalCents: number;
	};
	transactions: TransactionDto[];
}

/** Leitura: tudo calculado pelo engine/stores do servidor. */
export interface AgentReader {
	catalog(): Promise<Catalog>;
	monthSummary(month: string): Promise<MonthSummaryResponse>;
	listTransactions(
		query: TransactionQuery,
	): Promise<{ transactions: TransactionDto[]; nextCursor: string | null }>;
	getTransaction(id: string): Promise<TransactionDto | null>;
	cardInvoice(cardId: string, month: string): Promise<InvoiceData>;
	recurrences(): Promise<RecurrenceDto[]>;
}

/** Escrita: só é chamada depois que o dono confirma uma proposta (nunca direto por uma ferramenta). */
export interface AgentWriter {
	createTransaction(input: TransactionApiCreateBody): Promise<{ id: string }>;
	/** Troca a categoria e devolve o que havia antes, para o Desfazer. */
	setCategory(
		id: string,
		categoryId: string,
	): Promise<{ previousCategoryId: string | null; previousEditedByOwner: boolean }>;
	restoreCategory(id: string, categoryId: string | null, editedByOwner: boolean): Promise<void>;
	/** Pendente vira confirmado. `wasPending` diz se havia algo a fazer. */
	confirmTransaction(id: string): Promise<{ wasPending: boolean }>;
	/** Desfaz uma confirmação: volta a pendente. */
	revertConfirmation(id: string): Promise<void>;
	deleteTransaction(id: string): Promise<boolean>;
}

/** Erro esperado de uma ferramenta: a mensagem (pt-BR) é segura para o modelo e para o dono. */
export class ToolError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ToolError";
	}
}
