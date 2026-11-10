import type { Stores } from "@orbita/db";

/*
 * Quando uma conexão do Meu Pluggy deixa de existir (o dono a removeu no app ou no meu.pluggy.ai), as contas e os
 * cartões dela são ARQUIVADOS: saem do saldo, da carteira, dos limites, das faturas abertas e das contagens. Nada é
 * apagado: os lançamentos e as faturas já importados continuam no histórico (as leituras de histórico buscam a conta
 * arquivada pelo id). Reconectar o banco desarquiva (ver `linkAccounts` em `sync.ts` e `relink.ts`).
 */

export type RemovalStores = Pick<Stores, "pluggyConnections" | "accounts" | "cards">;

export interface Archived {
	accounts: number;
	cards: number;
}

/** Arquiva as contas e os cartões vivos ligados à conexão. Idempotente. */
export async function archiveConnectionData(
	stores: Pick<Stores, "accounts" | "cards">,
	connectionId: string,
): Promise<Archived> {
	return {
		accounts: await stores.accounts.archiveByConnection(connectionId),
		cards: await stores.cards.archiveByConnection(connectionId),
	};
}

/**
 * Remove a conexão da lista e arquiva o que veio por ela. `removed` é `false` se ela já não existia (as contas dela
 * ainda assim são arquivadas: o passo é idempotente e conserta uma remoção que parou no meio).
 */
export async function removePluggyConnection(
	stores: RemovalStores,
	id: string,
): Promise<Archived & { removed: boolean }> {
	const removed = await stores.pluggyConnections.remove(id);
	return { removed, ...(await archiveConnectionData(stores, id)) };
}

/**
 * Arquiva contas e cartões do Pluggy cuja conexão não existe mais (a conexão está fora de `liveConnectionIds`).
 * `includeUnlinked`: também os que não têm vínculo (gravados antes de a conexão de origem ser registrada); só passe
 * `true` quando TODAS as conexões vivas foram lidas nesta rodada (e portanto religaram o que é delas).
 */
export async function archiveOrphanedData(
	stores: Pick<Stores, "accounts" | "cards">,
	liveConnectionIds: readonly string[],
	options: { includeUnlinked: boolean },
): Promise<Archived> {
	return {
		accounts: await stores.accounts.archiveOrphans(liveConnectionIds, options),
		cards: await stores.cards.archiveOrphans(liveConnectionIds, options),
	};
}
