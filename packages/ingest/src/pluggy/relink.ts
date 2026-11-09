import type {
	AccountRecord,
	CardRecord,
	PluggyConnectionRecord,
	TransactionRecord,
	TransactionStore,
	UpsertByExternalInput,
} from "@orbita/db";
import type { PluggyClient } from "./client.ts";
import { PluggyError } from "./errors.ts";
import { type MappedTransaction, PLUGGY_SOURCE } from "./mapping.ts";

/*
 * Rede de segurança da reconexão. O caminho normal ("Reconectar" abre o Pluggy Connect em modo de atualização) mantém
 * o mesmo item e os mesmos ids. Se mesmo assim chega um item NOVO do mesmo banco, os ids de conta e de lançamento do
 * Pluggy são outros (são por item): sem este passo as contas, os cartões e ~122 dias de lançamentos duplicariam.
 * Aqui só há decisão (funções puras, mais um guarda que consulta o Pluggy); quem grava é o `sync.ts`.
 */

const plain = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

// ------------------------------------------------------ contas e cartões

type Relinkable = Pick<AccountRecord, "id" | "name" | "bankCode" | "externalId" | "source" | "archivedAt">;

/** Candidatas a religar: do Pluggy, vivas e cujo id não é de nenhuma conta que o Pluggy trouxe agora. */
function stale<T extends Relinkable>(all: readonly T[], currentIds: ReadonlySet<string>): T[] {
	return all.filter(
		(x) =>
			x.source === PLUGGY_SOURCE &&
			x.archivedAt === null &&
			x.externalId !== null &&
			!currentIds.has(x.externalId),
	);
}

/**
 * A conta do Órbita que o item novo deve herdar: mesmo tipo, mesmo banco (ISPB, quando um dos lados o tem) e mesmo
 * nome. O Órbita não guarda o número da conta, então só religa quando há UMA candidata e UMA conta nova que a queira;
 * na dúvida devolve `null` (a conta nova nasce separada e o dono junta à mão).
 */
export function pickRelinkAccount(
	accounts: readonly AccountRecord[],
	currentIds: ReadonlySet<string>,
	wanted: { name: string; kind: AccountRecord["kind"]; bankCode?: string | null | undefined },
	rivals: number,
): AccountRecord | null {
	if (rivals > 1) return null;
	const found = stale(accounts, currentIds).filter(
		(a) =>
			a.kind === wanted.kind &&
			(a.bankCode ?? null) === (wanted.bankCode ?? null) &&
			plain(a.name) === plain(wanted.name),
	);
	return found.length === 1 ? (found[0] ?? null) : null;
}

/**
 * O cartão que o item novo deve herdar: mesmo banco (ISPB, quando um dos lados o tem) e mesmos 4 últimos dígitos. Sem
 * os 4 dígitos, só o nome igual serve. Mais de uma candidata ou mais de um cartão novo igual: `null`.
 */
export function pickRelinkCard(
	cards: readonly CardRecord[],
	currentIds: ReadonlySet<string>,
	wanted: { name: string; last4?: string | null | undefined; bankCode?: string | null | undefined },
	rivals: number,
): CardRecord | null {
	if (rivals > 1) return null;
	const last4 = wanted.last4 ?? null;
	const found = stale(cards, currentIds).filter((c) => {
		if ((c.bankCode ?? null) !== (wanted.bankCode ?? null)) return false;
		return last4 !== null ? c.last4 === last4 : c.last4 === null && plain(c.name) === plain(wanted.name);
	});
	return found.length === 1 ? (found[0] ?? null) : null;
}

// --------------------------------------------- as outras conexões do dono

type OtherState =
	| { state: "live"; connectorId: number | null; accountIds: ReadonlySet<string> }
	/** O banco espera o dono (login de novo): a conexão não sincroniza mais. */
	| { state: "inactive"; connectorId: number | null; accountIds: ReadonlySet<string> }
	/** O Pluggy não conhece mais o item. */
	| { state: "gone" }
	/** Não deu para saber (falha passageira): nada é religado nem arquivado por causa dela. */
	| { state: "unknown" };

const NEEDS_USER = new Set(["LOGIN_ERROR", "WAITING_USER_INPUT", "WAITING_USER_ACTION"]);

export interface RelinkGuard {
	/**
	 * `true` se o id de conta/cartão ainda é de uma OUTRA conexão em uso (viva ou que não deu para conferir): então o
	 * item novo é um segundo login legítimo e não herda nada. Conexão parada (pede login) ou apagada não segura.
	 */
	heldElsewhere(externalId: string): Promise<boolean>;
	/** Alguma outra conexão não pôde ser conferida: religar agora seria arriscado, melhor esperar a próxima rodada. */
	undecided(): Promise<boolean>;
	/**
	 * As conexões antigas do mesmo banco que podem ser arquivadas depois de um religamento: paradas (pedem login) ou
	 * apagadas no Pluggy, e do mesmo conector (ou, se o Pluggy já esqueceu o item, com o mesmo nome).
	 */
	retirable(connectorId: number | null, names: readonly string[]): Promise<PluggyConnectionRecord[]>;
}

/** Consulta as outras conexões só quando alguém pergunta (a maioria das rodadas nunca pergunta). */
export function createRelinkGuard(
	client: Pick<PluggyClient, "item" | "accounts">,
	current: PluggyConnectionRecord,
	all: readonly PluggyConnectionRecord[],
): RelinkGuard {
	const others = all.filter((c) => c.id !== current.id);
	let views: Promise<Array<{ connection: PluggyConnectionRecord; view: OtherState }>> | undefined;
	const load = () => {
		views ??= Promise.all(
			others.map(async (connection) => ({ connection, view: await inspect(client, connection) })),
		);
		return views;
	};
	return {
		async heldElsewhere(externalId) {
			return (await load()).some(
				({ view }) => view.state === "unknown" || (view.state === "live" && view.accountIds.has(externalId)),
			);
		},
		async undecided() {
			return (await load()).some(({ view }) => view.state === "unknown");
		},
		async retirable(connectorId, names) {
			const wanted = new Set(names.map(plain).filter((n) => n !== ""));
			return (await load()).flatMap(({ connection, view }) => {
				if (view.state === "inactive") {
					return connectorId !== null && view.connectorId === connectorId ? [connection] : [];
				}
				if (view.state === "gone") {
					return connection.label !== null && wanted.has(plain(connection.label)) ? [connection] : [];
				}
				return [];
			});
		},
	};
}

async function inspect(
	client: Pick<PluggyClient, "item" | "accounts">,
	connection: PluggyConnectionRecord,
): Promise<OtherState> {
	try {
		const item = await client.item(connection.id);
		const accounts = await client.accounts(connection.id);
		const base = {
			connectorId: item.connector?.id ?? null,
			accountIds: new Set(accounts.map((a) => a.id)) as ReadonlySet<string>,
		};
		return NEEDS_USER.has(item.status) ? { state: "inactive", ...base } : { state: "live", ...base };
	} catch (e) {
		if (e instanceof PluggyError && (e.code === "not_found" || e.code === "forbidden"))
			return { state: "gone" };
		return { state: "unknown" };
	}
}

// ------------------------------------------------------- lançamentos

/** Possível duplicata: o desfecho tem o mesmo formato que o de `early.ts`, para o `sync.ts` tratar os dois igual. */
export type RelinkOutcome =
	| { outcome: "none" }
	/** O lançamento que já existia passou a ter o id novo do Pluggy. */
	| { outcome: "rekeyed"; transaction: TransactionRecord }
	/** Mais de um serve (ou há mais do banco que do Órbita): nada foi religado. */
	| { outcome: "ambiguous"; candidates: number };

type Upsert =
	| Extract<MappedTransaction, { action: "upsert" }>
	| Extract<MappedTransaction, { action: "refund" }>;

type Keyed = Pick<
	UpsertByExternalInput,
	"kind" | "amountCents" | "date" | "description" | "accountId" | "cardId"
>;

/** A identidade de um lançamento para comparar o antigo com o do item novo (não depende do id do Pluggy). */
export function relinkKey(
	input: Keyed,
	installment: { number: number; count: number } | null | undefined,
): string {
	return [
		input.kind,
		input.accountId ?? "",
		input.cardId ?? "",
		input.amountCents,
		input.date,
		plain(input.description),
		installment?.number ?? "",
		installment?.count ?? "",
	].join("|");
}

const keyOfRecord = (t: TransactionRecord) =>
	relinkKey(
		t,
		t.installmentNumber !== null ? { number: t.installmentNumber, count: t.installmentCount ?? 0 } : null,
	);

/**
 * Para um lançamento do item NOVO ainda não gravado, acha o que o item ANTIGO já gravou: da mesma conta/cartão (já
 * religados), do Pluggy, vivo, com o mesmo tipo, valor, dia, descrição normalizada e parcela. Só troca o id externo
 * (`rekeyExternal`): o que o dono editou fica. `sameInBatch` diz quantos do banco têm essa mesma identidade nesta rodada:
 * dois cafés iguais no mesmo dia casam um a um; se o número de iguais não bate com o de antigos, ninguém é religado
 * (`ambiguous`) e o do banco é gravado para revisão.
 */
export async function rekeyRelinked(
	transactions: Pick<TransactionStore, "listByTarget" | "rekeyExternal" | "existsByExternal">,
	mapped: Upsert,
	currentIds: ReadonlySet<string>,
	sameInBatch: number,
): Promise<RelinkOutcome> {
	const { input } = mapped;
	const target = input.cardId
		? { cardId: input.cardId }
		: input.accountId
			? { accountId: input.accountId }
			: null;
	if (target === null) return { outcome: "none" };
	if (await transactions.existsByExternal(PLUGGY_SOURCE, mapped.externalId)) return { outcome: "none" };
	const installment = "installment" in mapped ? mapped.installment : undefined;
	const key = relinkKey(input, installment);
	const rows = await transactions.listByTarget(target, { from: input.date, to: input.date });
	const candidates = rows
		.filter(
			(t) =>
				t.source === PLUGGY_SOURCE &&
				t.externalId !== null &&
				!currentIds.has(t.externalId) &&
				keyOfRecord(t) === key,
		)
		.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1));
	if (candidates.length === 0) return { outcome: "none" };
	if (candidates.length !== sameInBatch) return { outcome: "ambiguous", candidates: candidates.length };
	const best = candidates[0];
	if (best === undefined) return { outcome: "none" };
	const moved = await transactions.rekeyExternal(best.id, PLUGGY_SOURCE, mapped.externalId);
	return moved ? { outcome: "rekeyed", transaction: moved } : { outcome: "none" };
}
