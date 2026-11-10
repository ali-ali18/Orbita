import type { CardConfig, ClosingRule } from "@orbita/core";
import type { TransactionSource } from "@orbita/shared";

/**
 * De onde vem a regra de fechamento: "default" (ninguém escolheu), "inferred" (o sync a deduziu das faturas do banco) ou
 * "owner" (o dono escolheu: o sync nunca a muda).
 */
export type ClosingRuleSource = "default" | "inferred" | "owner";
export const CLOSING_RULE_SOURCES: readonly ClosingRuleSource[] = ["default", "inferred", "owner"];

export interface CardRecord {
	id: string;
	name: string;
	bankCode: string | null;
	last4: string | null;
	closingDay: number;
	dueDay: number;
	closingRule: ClosingRule;
	closingRuleSource: ClosingRuleSource;
	limitCents: number | null;
	/** Limite disponível que o banco informou (centavos). `null`: nunca informado. Só a sincronização grava. */
	availableCents: number | null;
	/**
	 * Saldo do cartão que o banco informou (`Account.balance` da conta CREDIT), em centavos. No conector que NÃO é Open
	 * Finance é a fatura aberta ainda não paga (docs.pluggy.ai). `null`: nunca informado. Só a sincronização grava.
	 */
	balanceCents: number | null;
	limitSyncedAt: Date | null;
	/** "manual" ou a origem que criou o cartão (ex.: "pluggy"). */
	source: TransactionSource;
	externalId: string | null;
	archivedAt: Date | null;
	/** A conexão do Meu Pluggy (itemId) que a sincronização ligou. `null`: manual, ou ligada antes do vínculo existir. */
	connectionId: string | null;
	/** Motivo do arquivamento que não foi do dono: "connection_removed". Só ele pode ser desfeito ao reconectar. */
	archiveReason: string | null;
	/** Sincronizações completas seguidas em que, sem conexão gravada, não apareceu em nenhuma conexão viva (2 arquiva). */
	unlinkedMisses: number;
	createdAt: Date;
	updatedAt: Date;
}

export interface CardInput {
	name: string;
	bankCode?: string | null;
	last4?: string | null;
	closingDay: number;
	dueDay: number;
	/** Padrão: "closing-day-next". */
	closingRule?: ClosingRule;
	/** Padrão: "owner" quando `closingRule` vem, senão "default". */
	closingRuleSource?: ClosingRuleSource;
	limitCents?: number | null;
	/** Padrão: "manual". Origem diferente de "manual" exige `externalId`. */
	source?: TransactionSource;
	externalId?: string | null;
}

export type CardPatch = Partial<{
	name: string;
	bankCode: string | null;
	last4: string | null;
	closingDay: number;
	dueDay: number;
	closingRule: ClosingRule;
	/** Padrão: mudar `closingRule` sem dizer a origem é escolha do dono ("owner"); o sync diz "inferred" ou "default". */
	closingRuleSource: ClosingRuleSource;
	limitCents: number | null;
}>;

/** A forma que `invoiceFor` e companhia esperam. */
export function toCardConfig(card: Pick<CardRecord, "closingDay" | "dueDay" | "closingRule">): CardConfig {
	return { closingDay: card.closingDay, dueDay: card.dueDay, closingRule: card.closingRule };
}

export interface CardStore {
	create(input: CardInput): Promise<CardRecord>;
	update(id: string, patch: CardPatch): Promise<CardRecord>;
	archive(id: string): Promise<CardRecord>;
	list(): Promise<CardRecord[]>;
	get(id: string): Promise<CardRecord | null>;
	/** O cartão ligado a um cadastro de fora, arquivado ou não. */
	findByExternal(source: TransactionSource, externalId: string): Promise<CardRecord | null>;
	/** Como `AccountStore.relinkExternal`, para cartão: troca só o identificador externo (mesma origem). */
	relinkExternal(id: string, externalId: string): Promise<CardRecord | null>;
	/** Liga o cartão à conexão do Meu Pluggy que o trouxe (idempotente, sem mexer em `updatedAt`). `null` se não existe ou é manual. */
	linkConnection(id: string, connectionId: string): Promise<CardRecord | null>;
	/** A conexão saiu: arquiva os cartões vivos ligados a ela (motivo "connection_removed"); faturas e lançamentos ficam. Devolve quantos. */
	archiveByConnection(connectionId: string): Promise<number>;
	/** Como `AccountStore.archiveOrphans`, para cartão. */
	archiveOrphans(
		liveConnectionIds: readonly string[],
		options: { unlinked: "ignore" | "strike" | "all" },
	): Promise<number>;
	/** Arquiva (motivo "connection_removed") o cartão vivo do Pluggy com este id externo, ligado ou não a uma conexão. */
	archiveExternalAsRemoved(externalId: string): Promise<boolean>;
	/** As arquivadas porque a conexão saiu (candidatas a religar quando o banco é reconectado). */
	listRemovedByConnection(): Promise<CardRecord[]>;
	/** Reconectou: desarquiva se o arquivamento foi por conexão removida (o do dono fica). `null` se não existe. */
	restoreFromConnection(id: string): Promise<CardRecord | null>;
	/** Atalho para o engine: `invoiceFor(date, (await cards.getConfig(id))!)`. */
	getConfig(id: string): Promise<CardConfig | null>;
	/**
	 * Grava o limite disponível que o banco informou e o instante da leitura. Não mexe em `updatedAt` (não é edição
	 * do dono). O saldo do cartão acompanha a leitura: ausente (`undefined`/`null`) grava `null`, não mantém o último.
	 * `not_found` se o cartão não existe; `invalid` se `availableCents` não é inteiro de centavos.
	 */
	recordAvailable(
		id: string,
		availableCents: number,
		syncedAt: Date,
		balanceCents?: number | null,
	): Promise<CardRecord>;
}
