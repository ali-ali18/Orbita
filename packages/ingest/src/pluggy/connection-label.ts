import { PLUGGY_LABEL_MAX } from "@orbita/shared";
import { cleanBankName, isMeuPluggyConnector } from "./bank-name.ts";
import type { PluggyAccount } from "./schemas.ts";

/*
 * Nome automático da conexão. No conector "MeuPluggy" o dono escolhe o banco dentro do widget e o Pluggy não
 * manda o nome da instituição no item nem na conta; todas as conexões chegam como "MeuPluggy". O que sobra de
 * pista é o nome das contas da própria conexão ("Conta Corrente Inter", "Mastercard Black"…).
 */

/** Nomes que aparecem no rótulo: mais que isso vira " +N". */
const SHOWN_NAMES = 2;
/** Cada nome cabe em 25 letras: 25 + ", " + 25 + " +99" = 56, dentro das 60 do rótulo. */
const NAME_MAX = 25;

const clean = (v: string) =>
	v
		.replace(/\p{Cc}/gu, " ")
		.replace(/\s+/g, " ")
		.trim();

const plain = (v: string) =>
	v
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]/g, "");

/** `marketingName` ou `name` da conta, saneado e limitado; `null` se não sobra nada. */
function accountLabel(account: PluggyAccount): string | null {
	const text = cleanBankName(account.marketingName ?? "") || cleanBankName(account.name);
	if (text.length === 0) return null;
	return text.length > NAME_MAX ? `${text.slice(0, NAME_MAX - 1).trimEnd()}…` : text;
}

/**
 * O nome pode ser trocado pela sincronização? Só se o dono não renomeou e o nome atual é vazio ou o do conector
 * MeuPluggy: nome digitado ou sugerido por outra fonte nunca é sobrescrito.
 */
export function labelIsReplaceable(
	current: string | null,
	connectorName: string | null | undefined,
	editedByOwner: boolean,
): boolean {
	if (editedByOwner) return false;
	const label = clean(current ?? "");
	if (label.length === 0) return true;
	// Só o "MeuPluggy" esconde o banco; o nome de um conector de verdade ("Nubank") já diz o que a conexão é.
	return isMeuPluggyConnector(connectorName) && plain(label) === plain(connectorName ?? "");
}

/**
 * Nome a partir das contas da conexão: contas BANK primeiro, depois CREDIT, sem repetir (ignora caixa e
 * acento), até 2 nomes e " +N" para o resto. `null` se nenhuma conta tem nome.
 */
export function labelFromAccounts(accounts: readonly PluggyAccount[]): string | null {
	const ordered = [
		...accounts.filter((a) => a.type === "BANK"),
		...accounts.filter((a) => a.type === "CREDIT"),
	];
	const seen = new Set<string>();
	const names: string[] = [];
	for (const account of ordered) {
		const name = accountLabel(account);
		if (name === null || seen.has(plain(name))) continue;
		seen.add(plain(name));
		names.push(name);
	}
	if (names.length === 0) return null;
	const shown = names.slice(0, SHOWN_NAMES).join(", ");
	const rest = names.length - SHOWN_NAMES;
	return (rest > 0 ? `${shown} +${rest}` : shown).slice(0, PLUGGY_LABEL_MAX);
}

/** Decisão completa: o nome novo, ou `null` para deixar como está. */
export function chooseConnectionLabel(input: {
	current: string | null;
	connectorName: string | null | undefined;
	editedByOwner: boolean;
	accounts: readonly PluggyAccount[];
}): string | null {
	if (!labelIsReplaceable(input.current, input.connectorName, input.editedByOwner)) return null;
	const next = labelFromAccounts(input.accounts);
	return next !== null && next !== input.current ? next : null;
}
