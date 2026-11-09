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
	/** Categoria que o banco mandou (só importados). Informativa: não decide nada sozinha. */
	sourceCategory: string | null;
	/** Nome do estabelecimento que o banco informou. */
	merchantName: string | null;
	/** O dono trocou a categoria à mão (PATCH): regras novas não reclassificam. */
	categoryEditedByOwner: boolean;
	/** Id das partes de uma compra dividida (todas as partes, e as partes de uma parte, compartilham o mesmo). */
	splitGroupId: string | null;
}

/**
 * Filtros de `listRecent`, combinados com E; dentro de cada lista, OU. Campo ausente ou lista vazia = sem filtro.
 * `accountIds` e `cardIds` juntos valem como OU entre os dois; a conta também casa com o destino de uma transferência.
 * `from`/`to` (datas) e `minCents`/`maxCents` são inclusivos.
 */
export interface TransactionFilter {
	kinds?: readonly TransactionKindValue[] | undefined;
	accountIds?: readonly string[] | undefined;
	cardIds?: readonly string[] | undefined;
	categoryIds?: readonly string[] | undefined;
	sources?: readonly TransactionSource[] | undefined;
	statuses?: readonly TransactionStatus[] | undefined;
	from?: LocalDate | undefined;
	to?: LocalDate | undefined;
	minCents?: number | undefined;
	maxCents?: number | undefined;
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
	/** Padrão: "confirmed". */
	status?: TransactionStatus;
	/** Padrão: "manual". */
	source?: TransactionSource;
	externalId?: string | null;
	note?: string | null;
	/** Só importados. Saneado e limitado a 120 letras pelo store. */
	sourceCategory?: string | null;
	merchantName?: string | null;
}

/** Uma parte da divisão de um lançamento. Sem `description`, vale a do original. */
export interface SplitPartInput {
	amountCents: number;
	categoryId?: string | null;
	description?: string | undefined;
}

/**
 * Item de um parcelamento. Parcela só nasce por `createInstallmentGroup`: o grupo é gerado
 * pelo store e número e total são obrigatórios.
 */
export type InstallmentInput = TransactionInput & {
	installmentNumber: number;
	installmentCount: number;
};

/**
 * Campos editáveis. Origem, id externo e parcelamento são a identidade do lançamento e não
 * mudam (passar um deles é `invalid`).
 *
 * Ao trocar `date` de um lançamento fora de parcelamento cujo `budgetMonth` era o padrão (o
 * mês da data antiga), o store recalcula `budgetMonth` pela data nova, a menos que o patch
 * informe um. O `invoiceMonth` NÃO é recalculado: quem sabe a fatura é o engine (`invoiceFor`),
 * então quem troca a data de uma compra no cartão deve mandar o `invoiceMonth` novo junto.
 */
export type TransactionPatch = Partial<
	Omit<
		TransactionData,
		| "source"
		| "externalId"
		| "installmentGroupId"
		| "installmentNumber"
		| "installmentCount"
		| "sourceCategory"
		| "merchantName"
		| "splitGroupId"
	>
>;

/** Posição de um lançamento importado num parcelamento. O `groupId` é decidido por quem importa (determinístico). */
export interface ExternalInstallment {
	groupId: string;
	number: number;
	count: number;
}

/**
 * O que o banco diz de um lançamento que o dono já tinha (ver `adoptExternal`). Só data e meses entram sempre;
 * categoria só se o lançamento não tinha uma.
 */
export interface AdoptExternalPatch {
	/** Data oficial do banco. */
	date: LocalDate;
	/** Sem informar, vale o do lançamento (ou o mês da data nova, se o dele era o padrão e não é parcela). */
	budgetMonth?: MonthKey | null | undefined;
	invoiceMonth?: MonthKey | null | undefined;
	/** Só usada se o lançamento ainda não tem categoria. */
	categoryId?: string | null | undefined;
	sourceCategory?: string | null | undefined;
	merchantName?: string | null | undefined;
}

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
	/**
	 * Como `upsertByExternal`, para uma parcela importada de um grupo que cresce com o tempo (o banco manda uma
	 * parcela por fatura). O grupo nasce com a primeira parcela vista e as seguintes entram nele; não exige as N
	 * parcelas. `duplicate` se o grupo já tem outra parcela com esse número (compras iguais confundidas).
	 */
	upsertInstallmentByExternal(
		source: TransactionSource,
		externalId: string,
		input: UpsertByExternalInput,
		installment: ExternalInstallment,
	): Promise<UpsertResult>;
	/**
	 * Adota um lançamento que NÃO veio de `source` (manual, chat, extrato…): ele passa a ter a origem e o
	 * identificador externo dados, e os próximos `upsertByExternal` com eles o encontram em vez de criar outro.
	 * Mantém tudo o que o dono definiu (descrição, nota, categoria, situação, marca de categoria escolhida) e aplica
	 * só o que está em `patch`. Devolve `null`, sem mudar nada, se o lançamento não existe mais, foi apagado, já é
	 * de `source` ou se a identidade externa já está em uso (inclusive de um lançamento apagado).
	 */
	adoptExternal(
		id: string,
		source: TransactionSource,
		externalId: string,
		patch: AdoptExternalPatch,
	): Promise<TransactionRecord | null>;
	/**
	 * Já existe lançamento com esta identidade externa? Conta também o apagado: o identificador continua
	 * reservado (a ingestão não recria o que o dono apagou). Serve para decidir antes de montar o lançamento.
	 */
	existsByExternal(source: TransactionSource, externalId: string): Promise<boolean>;
	/** O lançamento VIVO com esta identidade externa, ou `null` (não existe ou foi apagado). Serve para corrigir o já gravado. */
	findByExternal(source: TransactionSource, externalId: string): Promise<TransactionRecord | null>;
	/**
	 * Valida o lançamento inteiro depois do patch e grava só o que mudou. `not_found` se não existe ou
	 * foi apagado. Mudar o tipo de uma despesa que tem estornos vivos é `invalid`; apontar para conta,
	 * cartão ou categoria arquivada (se a referência mudou) é `bad_reference`.
	 */
	update(id: string, patch: TransactionPatch): Promise<TransactionRecord>;
	/**
	 * `true` se apagou agora, `false` se não existia ou já estava apagado. Na mesma operação
	 * apaga os estornos vivos da despesa e solta as recorrências ligadas a qualquer um deles.
	 */
	softDelete(id: string): Promise<boolean>;
	/**
	 * Divide um lançamento em partes com categorias diferentes, numa operação só: o original é apagado (a
	 * identidade externa dele fica reservada) e as partes nascem com o mesmo dia, conta/cartão, fatura, mês e
	 * situação, o mesmo `splitGroupId` e categoria marcada como escolhida pelo dono. As partes precisam somar
	 * EXATAMENTE o valor do original (`checkSplit` do engine). `invalid` para parcela, transferência, pagamento de
	 * fatura, estorno, gasto com estornos vivos ou soma que não fecha; `not_found` se não existe. Devolve as partes,
	 * na ordem recebida.
	 */
	splitTransaction(id: string, parts: readonly SplitPartInput[]): Promise<TransactionRecord[]>;
	/** Apaga todas as parcelas do grupo (com a mesma cascata de `softDelete`). Devolve quantas parcelas. */
	softDeleteGroup(groupId: string): Promise<number>;
	/**
	 * Apaga DE VERDADE (não é exclusão lógica), numa operação só, todos os lançamentos de uma origem de fora,
	 * os que o dono já tinha apagado inclusive (o `externalId` fica livre para a ingestão trazer de novo), os estornos
	 * deles (de qualquer origem: um estorno não vive sem a compra) e as ligações com recorrências. Lançamentos de
	 * outras origens, contas, cartões e recorrências ficam. `invalid` para "manual". Devolve quantos lançamentos saíram.
	 */
	hardDeleteBySource(source: TransactionSource): Promise<number>;
	get(id: string): Promise<TransactionRecord | null>;
	/** Por data, depois por criação. */
	listByBudgetMonth(month: MonthKey): Promise<TransactionRecord[]>;
	/** Meses de orçamento que têm ao menos um lançamento vivo, do mais recente para o mais antigo (sem repetir). */
	listBudgetMonths(): Promise<MonthKey[]>;
	listByInvoice(cardId: string, invoiceMonth: MonthKey): Promise<TransactionRecord[]>;
	/** Pagamentos de fatura (`card_payment`) vivos do cartão com data entre `from` e `to`, inclusive, por data. */
	listCardPayments(cardId: string, range: { from: LocalDate; to: LocalDate }): Promise<TransactionRecord[]>;
	/**
	 * Lançamentos vivos de uma conta OU de um cartão (exatamente um dos dois) com data entre `from` e `to`, inclusive,
	 * de qualquer origem e situação. Serve à importação para achar possível duplicata (mesma data e valor).
	 * `invalid` se `target` não tiver exatamente um dos dois ids.
	 */
	listByTarget(
		target: { accountId?: string; cardId?: string },
		range: { from: LocalDate; to: LocalDate },
	): Promise<TransactionRecord[]>;
	/** Os que esperam revisão, do mais recente para o mais antigo. `limit` padrão 200, máximo 500. */
	listPending(options?: { limit?: number }): Promise<TransactionRecord[]>;
	/**
	 * Vários lançamentos pelo id, só os que existem e não foram apagados (a ordem é a das listas
	 * de mês). Serve para buscar o original de estornos de outros meses (`summarizeMonth`).
	 * Aceita de 0 a 500 ids; ids repetidos contam uma vez.
	 */
	getMany(ids: readonly string[]): Promise<TransactionRecord[]>;
	/** Todos os lançamentos vivos cuja categoria o dono não trocou à mão (para reclassificar por regra). */
	listCategoryNotEditedByOwner(): Promise<TransactionRecord[]>;
	/**
	 * Do mais recente para o mais antigo (data, id). `before` é o último item da página anterior; `filter`
	 * restringe a lista (a paginação por cursor continua valendo sobre o resultado filtrado).
	 */
	listRecent(options: {
		limit: number;
		before?: TransactionCursor;
		filter?: TransactionFilter | undefined;
	}): Promise<TransactionRecord[]>;
	/** Quantos lançamentos vivos passam no filtro (sem filtro, todos). Mesma regra de `listRecent`. */
	countMatching(filter?: TransactionFilter): Promise<number>;
	/**
	 * Parcelamentos ainda em andamento: com alguma parcela cuja fatura (ou mês do orçamento,
	 * se não for de cartão) é `activeFromMonth` ou depois. Devolve o grupo inteiro, por data.
	 */
	listInstallmentGroups(activeFromMonth: MonthKey): Promise<InstallmentGroupRecord[]>;
}
