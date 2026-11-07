import type { PluggySyncStatus } from "@orbita/shared";

export interface PluggyConnectionRecord {
	/** O itemId do Pluggy (UUID minúsculo). */
	id: string;
	label: string | null;
	createdAt: Date;
	/** Início da última sincronização que terminou sem erro; a próxima janela parte daqui. */
	lastSyncAt: Date | null;
	lastStatus: PluggySyncStatus | null;
	/** Mensagem sanitizada (sem segredo). */
	lastError: string | null;
	/** `true` quando o dono deu o nome: a sincronização nunca mais o troca. */
	labelEditedByOwner: boolean;
	/** Contas e cartões (não arquivados) que a última sincronização ligou a esta conexão. */
	accountCount: number;
	cardCount: number;
}

export interface PluggyConnectionInput {
	id: string;
	label?: string | null;
	/** O nome veio do dono (digitado), não do Pluggy. Padrão `false`. */
	byOwner?: boolean;
}

export interface PluggySyncResult {
	status: PluggySyncStatus;
	error?: string | null;
	/** Só quando a sincronização terminou "ok": avança a janela da próxima. */
	syncedAt?: Date;
	/** Quantas contas e cartões a sincronização ligou à conexão. Ausente (erro antes de ligar) = não mexe. */
	counts?: { accounts: number; cards: number };
}

/**
 * Conexões do Meu Pluggy cadastradas pelo dono (o plano pessoal não lista pela API). Aqui só mora
 * o id e o resultado da última sincronização; as chaves ficam no cofre.
 */
export interface PluggyConnectionStore {
	/** `duplicate` se já está cadastrada; `invalid` se o id não é UUID ou o nome é grande demais. */
	add(input: PluggyConnectionInput): Promise<PluggyConnectionRecord>;
	/** `true` se existia. */
	remove(id: string): Promise<boolean>;
	get(id: string): Promise<PluggyConnectionRecord | null>;
	/** Da mais antiga para a mais nova. */
	list(): Promise<PluggyConnectionRecord[]>;
	/** Grava o resultado da sincronização. `null` se a conexão sumiu no meio (removida pelo dono). */
	recordSync(id: string, result: PluggySyncResult): Promise<PluggyConnectionRecord | null>;
	/** O dono renomeia (`invalid` se vazio, grande ou com controle). `null` se a conexão não existe. */
	rename(id: string, label: string): Promise<PluggyConnectionRecord | null>;
	/**
	 * Nome sugerido pela sincronização: só vale se o dono ainda não renomeou (a checagem é atômica). `true` se gravou.
	 */
	setAutoLabel(id: string, label: string): Promise<boolean>;
	/**
	 * Esquece a última sincronização boa de todas as conexões (`lastSyncAt` volta a `null`): a próxima rodada refaz a
	 * janela inicial inteira. Devolve quantas conexões. Não mexe em nome, status nem contagens.
	 */
	resetSyncWindow(): Promise<number>;
}
