import type { DbClient } from "./client.ts";
import { badReference } from "./errors.ts";
import { archivedAccount, archivedCard, archivedCategory, type Refs } from "./references.ts";

/** Mesma regra e mesma ordem de `assertRefs` (memória), com consultas em vez de mapas. */
export async function checkReferences(client: DbClient, refs: Refs, previous: Refs = {}): Promise<void> {
	const accountIds = [...new Set((refs.accountIds ?? []).filter((id): id is string => Boolean(id)))];
	const accounts = new Map(
		(
			await client.account.findMany({
				where: { id: { in: accountIds } },
				select: { id: true, archivedAt: true },
			})
		).map((a) => [a.id, a.archivedAt]),
	);
	(refs.accountIds ?? []).forEach((id, i) => {
		if (!id) return;
		const archivedAt = accounts.get(id);
		if (archivedAt === undefined) throw badReference();
		if (archivedAt !== null && previous.accountIds?.[i] !== id) throw archivedAccount();
	});
	if (refs.cardId) {
		const card = await client.card.findUnique({ where: { id: refs.cardId }, select: { archivedAt: true } });
		if (!card) throw badReference();
		if (card.archivedAt !== null && previous.cardId !== refs.cardId) throw archivedCard();
	}
	if (refs.categoryId) {
		const category = await client.category.findUnique({
			where: { id: refs.categoryId },
			select: { archivedAt: true },
		});
		if (!category) throw badReference();
		if (category.archivedAt !== null && previous.categoryId !== refs.categoryId) throw archivedCategory();
	}
}
