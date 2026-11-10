import { PLUGGY_LABEL_MAX } from "@orbita/shared";
import {
	bankByTransferNumber,
	bankDisplayName,
	cleanBankName,
	findKnownBank,
	isMeuPluggyConnector,
	isWeakCardName,
	rawBankName,
} from "./bank-name.ts";
import type { PluggyAccount, PluggyInvestment } from "./schemas.ts";

/*
 * Nome automático da conexão: o nome curto do banco ("Santander", "Nubank", "C6 Bank"). No conector "MeuPluggy" o
 * item não diz o banco (`connector.name` é "MeuPluggy" em todos); a pista está nas contas: o banco citado no nome
 * ("BANCO INTER", "Nu Pagamentos S.A. - Instituição de Pagamento") ou o COMPE do `bankData.transferNumber`.
 * Sem conta nenhuma não há pista: o nome fica como está e o app mostra a situação da conexão.
 */

/** Tamanho de cada nome no rótulo antigo ("Conta, Cartão +N"): 24 letras e "…". Só serve para reconhecê-lo. */
const LEGACY_NAME_MAX = 25;

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

/** Nome que só diz o tipo da conta ("Conta Corrente", "Cartão de Crédito"), não o banco. */
const isGenericName = (name: string) =>
	/\b(conta|corrente|poupanca|pagamento|cartao|credito)\b/.test(
		name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(),
	);

const namesOf = (a: PluggyAccount): string[] =>
	[a.marketingName, a.name].flatMap((n) => (n ? [cleanBankName(n)] : [])).filter((n) => n.length > 0);

const cut = (name: string) =>
	name.length > PLUGGY_LABEL_MAX ? `${name.slice(0, PLUGGY_LABEL_MAX - 1).trimEnd()}…` : name;

/** Contas BANK primeiro, depois CREDIT, depois o resto (investimento…): a conta diz o banco melhor que o cartão. */
function ordered(accounts: readonly PluggyAccount[]): PluggyAccount[] {
	return [
		...accounts.filter((a) => a.type === "BANK"),
		...accounts.filter((a) => a.type === "CREDIT"),
		...accounts.filter((a) => a.type !== "BANK" && a.type !== "CREDIT"),
	];
}

/**
 * O nome da conexão pelos dados do Pluggy, sempre o mesmo para os mesmos dados. Na ordem:
 * 1. o conector, quando ele é o banco (não é o "MeuPluggy");
 * 2. o banco conhecido citado no nome de alguma conta ("BANCO INTER" → "Inter");
 * 3. o banco pelo COMPE do `transferNumber` de alguma conta ("336/…" → "C6 Bank");
 * 4. banco que o Órbita não conhece: o nome da conta que não é só o tipo ("Banco Exemplo S.A."), senão o do cartão
 *    que não é só bandeira, senão o primeiro nome que houver.
 * `null` sem pista nenhuma (conexão sem contas no MeuPluggy).
 */
export function labelFromAccounts(input: {
	connectorName: string | null | undefined;
	accounts: readonly PluggyAccount[];
}): string | null {
	const connector = input.connectorName?.trim() ?? "";
	if (connector !== "" && !isMeuPluggyConnector(connector)) {
		const named = cleanBankName(connector);
		if (named !== "") return cut(bankDisplayName(findKnownBank(named) ?? named));
	}
	const accounts = ordered(input.accounts);
	for (const a of accounts) {
		const bank = findKnownBank(a.marketingName) ?? findKnownBank(a.name);
		if (bank) return bankDisplayName(bank);
	}
	for (const a of accounts) {
		const bank = bankByTransferNumber(a.bankData?.transferNumber);
		if (bank) return bankDisplayName(bank);
	}
	const names = accounts.flatMap((a) => namesOf(a).map((name) => ({ type: a.type, name })));
	const pick =
		names.find((n) => n.type === "BANK" && !isGenericName(n.name)) ??
		names.find((n) => n.type === "CREDIT" && !isGenericName(n.name) && !isWeakCardName(n.name)) ??
		names[0];
	return pick ? cut(pick.name) : null;
}

/**
 * O nome pelo emissor dos investimentos, para a conexão que não trouxe conta nem cartão (só uma posição de renda
 * fixa: `issuer` "BANCO C6 S.A." → "C6 Bank"). Só vale quando TODAS as posições têm emissor e todos são o mesmo banco
 * que o Órbita conhece; emissor ausente, diferente ou desconhecido não dá nome (`null`).
 */
export function labelFromIssuers(issuers: readonly (string | null | undefined)[]): string | null {
	if (issuers.length === 0) return null;
	const banks = new Set<string | null>(issuers.map((i) => findKnownBank(i)));
	const [only] = banks;
	return banks.size === 1 && only ? bankDisplayName(only) : null;
}

/**
 * Os emissores que podem dar nome à conexão, ou `[]`. `issuer` é quem EMITE o produto, não quem guarda a posição (uma
 * corretora guarda CDB de outros bancos; `institution` só vem no conector B3). Por isso só vale com: leitura sem linha
 * descartada, toda posição de renda fixa (`FIXED_INCOME`: ação e fundo têm emissor que não é o banco da conexão) e
 * `institution.name`, se vier, no mesmo banco do emissor. Quem chama ainda exige conector MeuPluggy e conexão que nunca
 * teve conta nem cartão.
 */
export function issuerHints(
	rows: readonly PluggyInvestment[],
	dropped: number,
): (string | null | undefined)[] {
	if (dropped > 0 || rows.length === 0) return [];
	if (!rows.every((r) => r.type === "FIXED_INCOME")) return [];
	const issuers = rows.map((r) => r.issuer);
	const bank = labelFromIssuers(issuers);
	if (bank === null) return [];
	for (const r of rows) {
		const holder = r.institution?.name;
		if (holder && bankDisplayName(findKnownBank(holder) ?? "") !== bank) return [];
	}
	return issuers;
}

/** O rótulo é exatamente o nome de exibição de um banco conhecido ("C6 Bank", "Santander")? */
const isKnownBankLabel = (label: string): boolean => {
	const bank = findKnownBank(label);
	return bank !== null && bankDisplayName(bank) === label;
};

/**
 * O nome gravado é um dos que a própria sincronização já deu (e pode ser refeito)? As versões antigas juntavam o nome
 * das contas ("Inter, GOLD", "Nu Pagamentos S.A. - Ins…, Gold", "Conta, Cartão +2"). Vale quando CADA pedaço é: um nome
 * cortado com "…" (só o rótulo antigo cortava assim), só bandeira/nível de cartão ("Gold"), ou igual ao nome de uma
 * conta da conexão; e só no formato exato do rótulo antigo (vários pedaços ligados por ", ", pedaço cortado com "…" ou
 * " +N" no fim). Um pedaço só ("Gold", "Black", "Meu C6", "Conta Inter") pode ser apelido que o dono digitou antes de
 * existir a marca `labelEditedByOwner`: não cai aqui.
 */
export function isAutoLabel(current: string, accounts: readonly PluggyAccount[]): boolean {
	const text = clean(current);
	const label = text.replace(/\s\+\d+$/, "");
	if (label === "") return true;
	// Só o FORMATO exato do rótulo antigo: vários pedaços ligados por ", ", um pedaço cortado com "…" ou o " +N" do fim.
	// Um pedaço só que é bandeira/nível ("Gold", "Black") ou nome de conta pode ser apelido do dono.
	const pieces = label.split(",");
	const truncated = (part: string) => /(…|\.{3})$/u.test(part.trim());
	if (!(pieces.length > 1 || text !== label || pieces.some(truncated))) return false;
	const known = new Set<string>();
	for (const a of accounts) {
		for (const n of [a.marketingName, a.name]) {
			if (!n) continue;
			known.add(plain(cleanBankName(n)));
			known.add(plain(rawBankName(n)));
		}
	}
	known.delete("");
	return pieces.every((piece) => {
		const part = piece.trim();
		if (part === "") return false;
		if (/(…|\.{3})$/u.test(part)) return part.length <= LEGACY_NAME_MAX + 2;
		return isWeakCardName(part) || known.has(plain(part));
	});
}

/**
 * O nome pode ser trocado pela sincronização? Nunca o que o dono deu. Fora isso: vazio, o do conector ("MeuPluggy",
 * ou o nome cru do banco quando o conector é o banco) e os que a sincronização mesma gerou (`isAutoLabel`).
 */
export function labelIsReplaceable(
	current: string | null,
	connectorName: string | null | undefined,
	editedByOwner: boolean,
	accounts: readonly PluggyAccount[] = [],
): boolean {
	if (editedByOwner) return false;
	const label = clean(current ?? "");
	if (label.length === 0) return true;
	if (isMeuPluggyConnector(label)) return true;
	if (connectorName && plain(label) === plain(connectorName)) return true;
	// Nome provisório: o do emissor dos investimentos (ex.: "C6 Bank") vale enquanto não há contas; com contas, o nome
	// derivado delas o substitui (o do dono nunca, `editedByOwner` já saiu acima).
	if (accounts.length > 0 && isKnownBankLabel(label)) return true;
	return isAutoLabel(label, accounts);
}

/** Decisão completa: o nome novo, ou `null` para deixar como está. */
export function chooseConnectionLabel(input: {
	current: string | null;
	connectorName: string | null | undefined;
	editedByOwner: boolean;
	accounts: readonly PluggyAccount[];
	/** `issuer` de cada investimento da conexão; só lido quando ela não tem conta nenhuma (ver `labelFromIssuers`). */
	investmentIssuers?: readonly (string | null | undefined)[];
}): string | null {
	if (!labelIsReplaceable(input.current, input.connectorName, input.editedByOwner, input.accounts)) {
		return null;
	}
	// Depois das contas e antes de desistir: o emissor dos investimentos (conexão que só trouxe posições).
	const next =
		labelFromAccounts(input) ??
		(input.accounts.length === 0 ? labelFromIssuers(input.investmentIssuers ?? []) : null);
	// Sem pista do banco, o nome do conector "MeuPluggy" não é nome: fica como está (o app mostra a situação).
	if (next === null || isMeuPluggyConnector(next)) return null;
	return next !== input.current ? next : null;
}
