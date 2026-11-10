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
 *
 * `listExternalIds` (plano B para dados sem vínculo gravado): os ids de conta que o Pluggy ainda devolve para o item.
 * Quem chama o implementa com o cliente; falha ou item inexistente (404) devolve vazio, e a remoção segue (a varredura
 * da próxima sincronização cobre o resto). Nunca derruba a remoção.
 */
export async function removePluggyConnection(
	stores: RemovalStores,
	id: string,
	options: { listExternalIds?: (itemId: string) => Promise<readonly string[]> } = {},
): Promise<Archived & { removed: boolean }> {
	let external: readonly string[] = [];
	try {
		external = (await options.listExternalIds?.(id)) ?? [];
	} catch {
		external = [];
	}
	const removed = await stores.pluggyConnections.remove(id);
	const linked = await archiveConnectionData(stores, id);
	let accounts = linked.accounts;
	let cards = linked.cards;
	for (const externalId of external) {
		if (await stores.accounts.archiveExternalAsRemoved(externalId)) accounts += 1;
		if (await stores.cards.archiveExternalAsRemoved(externalId)) cards += 1;
	}
	return { removed, accounts, cards };
}

/**
 * Arquiva contas e cartões do Pluggy cuja conexão não existe mais (a conexão está fora de `liveConnectionIds`).
 * Os sem vínculo (gravados antes de a conexão de origem ser registrada) dependem de `unlinked`: "ignore" não mexe,
 * "strike" soma uma ausência e arquiva na segunda seguida (só numa sincronização em que TODAS as conexões vivas foram
 * lidas por completo), "all" arquiva já (não há conexão alguma).
 */
export async function archiveOrphanedData(
	stores: Pick<Stores, "accounts" | "cards">,
	liveConnectionIds: readonly string[],
	options: { unlinked: "ignore" | "strike" | "all" },
): Promise<Archived> {
	return {
		accounts: await stores.accounts.archiveOrphans(liveConnectionIds, options),
		cards: await stores.cards.archiveOrphans(liveConnectionIds, options),
	};
}
