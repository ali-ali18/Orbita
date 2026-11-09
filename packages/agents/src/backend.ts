import type {
	BudgetBefore,
	GoalsListResponse,
	MonthSummaryResponse,
	PlanDto,
	RecurrenceDto,
	SetupAnalysis,
	SetupApplyInput,
	SetupUndo,
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
	/** `open`, `unpaid`, `partial`, `paid` ou `history` (fatura antiga sem pagamento registrado; do engine). */
	paymentStatus: string;
	/** O total da fatura: o do banco, quando há; senão a soma dos lançamentos (do ledger). */
	totalCents: number;
	paidCents: number;
	/** O que ainda se deve nesta fatura (do ledger): o total se aberta; total menos pago se fechada; 0 se histórica. */
	owedCents: number;
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
	/** Metas ativas com guardado, percentual, valor mensal e situação (tudo do engine). */
	goals(): Promise<GoalsListResponse>;
	/** Plano da renda do mês (engine `incomePlan`): baldes, categorias, avisos. `reservePercent` ausente = padrão. */
	incomePlan(month: string, reservePercent?: number): Promise<PlanDto>;
	/** Análise do histórico do dono (engine): assinaturas, candidatos a regra e salário. Só números do engine. */
	setupAnalysis(): Promise<SetupAnalysis>;
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
	/** Grava o plano da renda no orçamento (o dono já confirmou) e devolve o que valia antes, para o Desfazer. */
	applyPlan(month: string, reservePercent: number): Promise<{ previous: BudgetBefore[] }>;
	/** Devolve os limites ao que eram antes de `applyPlan`. */
	restoreBudgets(previous: BudgetBefore[]): Promise<void>;
	/**
	 * "Configurar com a Órbita": cria assinaturas, regras, renda e (se pedido) aplica o plano, numa operação só
	 * (compensa os passos anteriores se um falha). Confere cada número contra a análise de agora. Devolve o que o
	 * Desfazer precisa.
	 */
	applySetup(input: SetupApplyInput): Promise<SetupUndo>;
	/** Reverte `applySetup` por inteiro (repetir não falha). */
	undoSetup(undo: SetupUndo): Promise<void>;
}

/** Erro esperado de uma ferramenta: a mensagem (pt-BR) é segura para o modelo e para o dono. */
export class ToolError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ToolError";
	}
}
