import type { AccountKind, TransactionSource } from "@orbita/shared";

/** Motivo de arquivamento que não é escolha do dono: a conexão do Meu Pluggy saiu. */
export const ARCHIVE_CONNECTION_REMOVED = "connection_removed";

export interface AccountRecord {
	id: string;
	name: string;
	kind: AccountKind;
	/** ISPB do banco, para achar o logo. */
	bankCode: string | null;
	/** "manual" ou a origem que criou a conta (ex.: "pluggy"); com `externalId`, identifica o cadastro de fora. */
	source: TransactionSource;
	externalId: string | null;
	/** Saldo que o banco informou (centavos, pode ser negativo). `null`: nunca informado. Só a sincronização grava. */
	balanceCents: number | null;
	balanceSyncedAt: Date | null;
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

export interface AccountInput {
	name: string;
	kind: AccountKind;
	bankCode?: string | null;
	/** Padrão: "manual". Origem diferente de "manual" exige `externalId`. */
	source?: TransactionSource;
	externalId?: string | null;
}

export type AccountPatch = Partial<{ name: string; kind: AccountKind; bankCode: string | null }>;

export interface AccountStore {
	create(input: AccountInput): Promise<AccountRecord>;
	/** `not_found` se a conta não existe. */
	update(id: string, patch: AccountPatch): Promise<AccountRecord>;
	/** Esconde da lista, mas os lançamentos antigos seguem apontando para ela. Idempotente. */
	archive(id: string): Promise<AccountRecord>;
	/** Só as ativas, da mais antiga para a mais nova. */
	list(): Promise<AccountRecord[]>;
	/** Também devolve arquivada (lançamentos antigos precisam do nome). */
	get(id: string): Promise<AccountRecord | null>;
	/** A conta ligada a um cadastro de fora, arquivada ou não. */
	findByExternal(source: TransactionSource, externalId: string): Promise<AccountRecord | null>;
	/**
	 * Aponta uma conta de fora (`source` diferente de "manual") para outro identificador externo da MESMA origem: o
	 * banco refez a conexão e os ids mudaram. Só mexe no `externalId`; nome, lançamentos e arquivamento ficam.
	 * `null`, sem mudar nada, se a conta não existe, é manual ou a identidade nova já está em uso.
	 */
	relinkExternal(id: string, externalId: string): Promise<AccountRecord | null>;
	/**
	 * Liga a conta à conexão do Meu Pluggy que a trouxe (a sincronização chama a cada rodada; idempotente, sem mexer em
	 * `updatedAt`). `null` se não existe ou é manual.
	 */
	linkConnection(id: string, connectionId: string): Promise<AccountRecord | null>;
	/**
	 * A conexão saiu: arquiva as contas vivas ligadas a ela (motivo "connection_removed"). Os lançamentos ficam. Devolve
	 * quantas.
	 */
	archiveByConnection(connectionId: string): Promise<number>;
	/**
	 * Arquiva os vivos do Pluggy cuja conexão gravada não está entre `liveConnectionIds` (a conexão saiu). Os sem conexão
	 * gravada (anteriores à coluna) dependem de `unlinked`: "ignore" não mexe; "strike" soma uma ausência e arquiva com
	 * 2 seguidas (quem chama só usa numa sincronização completa e sem dúvida); "all" arquiva já (não há conexão alguma).
	 * Devolve quantos foram arquivados.
	 */
	archiveOrphans(
		liveConnectionIds: readonly string[],
		options: { unlinked: "ignore" | "strike" | "all" },
	): Promise<number>;
	/** Arquiva (motivo "connection_removed") o vivo do Pluggy com este id externo, ligado ou não a uma conexão. `true` se arquivou. */
	archiveExternalAsRemoved(externalId: string): Promise<boolean>;
	/** As arquivadas porque a conexão saiu (candidatas a religar quando o banco é reconectado). */
	listRemovedByConnection(): Promise<AccountRecord[]>;
	/** Reconectou: desarquiva se o arquivamento foi por conexão removida (o do dono fica). `null` se não existe. */
	restoreFromConnection(id: string): Promise<AccountRecord | null>;
	/**
	 * Grava o saldo que o banco informou e o instante da leitura. Não mexe em `updatedAt` (não é edição do dono).
	 * `not_found` se a conta não existe; `invalid` se `balanceCents` não é inteiro de centavos.
	 */
	recordBalance(id: string, balanceCents: number, syncedAt: Date): Promise<AccountRecord>;
}
