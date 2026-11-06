import { DataError } from "./errors.ts";
import { ACCOUNT_ARCHIVED_MESSAGE, CARD_ARCHIVED_MESSAGE, CATEGORY_ARCHIVED_MESSAGE } from "./messages.ts";

/** Para o que um lançamento ou recorrência aponta. A ordem das contas é a ordem da checagem. */
export interface Refs {
	accountIds?: (string | null)[];
	cardId?: string | null;
	categoryId?: string | null;
}

export const archivedAccount = () => new DataError("bad_reference", ACCOUNT_ARCHIVED_MESSAGE);
export const archivedCard = () => new DataError("bad_reference", CARD_ARCHIVED_MESSAGE);
export const archivedCategory = () => new DataError("bad_reference", CATEGORY_ARCHIVED_MESSAGE);
