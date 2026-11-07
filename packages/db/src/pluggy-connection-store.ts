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
}

export interface PluggyConnectionInput {
	id: string;
	label?: string | null;
}

export interface PluggySyncResult {
	status: PluggySyncStatus;
	error?: string | null;
	/** Só quando a sincronização terminou "ok": avança a janela da próxima. */
	syncedAt?: Date;
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
}
