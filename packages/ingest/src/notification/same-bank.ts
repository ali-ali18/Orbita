import type { Stores } from "@orbita/db";

/** Contas ativas (corrente ou carteira) do mesmo banco do cartão, pelo ISPB. Sem banco no cartão: nenhuma. */
export async function sameBankAccountIds(
	stores: Pick<Stores, "cards" | "accounts">,
	cardId: string,
): Promise<string[]> {
	const card = await stores.cards.get(cardId);
	if (!card || card.bankCode === null) return [];
	return (await stores.accounts.list())
		.filter((a) => a.archivedAt === null && (a.kind === "checking" || a.kind === "wallet"))
		.filter((a) => a.bankCode === card.bankCode)
		.map((a) => a.id);
}

/** Cartões ativos de uma conta do mesmo banco (o caminho inverso, para a notificação que chega depois do banco). */
export async function sameBankCardIds(
	stores: Pick<Stores, "cards">,
	bankCode: string | null,
): Promise<string[]> {
	if (bankCode === null) return [];
	return (await stores.cards.list())
		.filter((c) => c.archivedAt === null && c.bankCode === bankCode)
		.map((c) => c.id);
}
