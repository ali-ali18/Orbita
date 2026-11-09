import type { AccountKind, TransactionSource } from "@orbita/shared";

export interface AccountRecord {
	id: string;
	name: string;
	kind: AccountKind;
	/** ISPB do banco, para achar o logo. */
	bankCode: string | null;
	/** "manual" ou a origem que criou a conta (ex.: "pluggy"); com `externalId`, identifica o cadastro de fora. */
	source: TransactionSource;
	externalId: string | null;
	archivedAt: Date | null;
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
}
