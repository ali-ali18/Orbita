import { z } from "zod";
import { PluggyError, type PluggyErrorCode, pluggyError } from "./errors.ts";
import {
	accountSchema,
	authResponse,
	billSchema,
	categorySchema,
	connectTokenResponse,
	cursorPage,
	investmentSchema,
	investmentTransactionSchema,
	itemResponse,
	type PluggyAccount,
	type PluggyBill,
	type PluggyCategory,
	type PluggyInvestment,
	type PluggyInvestmentTransaction,
	type PluggyItem,
	type PluggyTransaction,
	page,
	transactionSchema,
} from "./schemas.ts";

/** O único servidor com que o Órbita fala. Fixo no código: nada vindo de fora escolhe o host. */
export const PLUGGY_BASE_URL = "https://api.pluggy.ai";

export type PluggyFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface PluggyClientOptions {
	fetch: PluggyFetch;
	clientId: string;
	clientSecret: string;
	now?: () => Date;
	/** Por pedido. Padrão 20 s. */
	timeoutMs?: number;
	/** Tamanho máximo do corpo de uma resposta. Padrão 5 MB. */
	maxBytes?: number;
}

/** Lançamentos válidos e quantas linhas vieram fora do formato (descartadas uma a uma, sem derrubar a página). */
export interface PluggyTransactionsResult {
	transactions: PluggyTransaction[];
	dropped: number;
}

/** Posições de investimento válidas e quantas linhas vieram fora do formato (descartadas uma a uma). */
export interface PluggyInvestmentsResult {
	investments: PluggyInvestment[];
	dropped: number;
}

export interface PluggyInvestmentTransactionsResult {
	transactions: PluggyInvestmentTransaction[];
	dropped: number;
}

export interface PluggyClient {
	/**
	 * `POST /connect_token` com `clientUserId` fixo: o token de curta duração com que a página web abre o
	 * Pluggy Connect. Devolve só o `accessToken` (nunca a apiKey). Com `updateItemId` o token é de ATUALIZAÇÃO
	 * (`itemId` no corpo): o widget reabre aquele item em vez de criar outro.
	 */
	connectToken(clientUserId: string, updateItemId?: string): Promise<string>;
	/** `GET /items/{id}`: existe? qual banco? em que estado? */
	item(itemId: string): Promise<PluggyItem>;
	/** `GET /accounts?itemId=`: todas as páginas. */
	accounts(itemId: string): Promise<PluggyAccount[]>;
	/** `GET /bills?accountId=` (cartão): todas as páginas. Quem não é Open Finance pode não ter faturas. */
	bills(accountId: string): Promise<PluggyBill[]>;
	/** `GET /categories`: a árvore de categorias do Pluggy (todas as páginas). Não depende da conexão. */
	categories(): Promise<PluggyCategory[]>;
	/**
	 * `GET /v2/transactions?accountId=&dateFrom=&dateTo=` (paginação por cursor; o `GET /transactions` por página está
	 * marcado como obsoleto no SDK): todas as páginas. Datas "AAAA-MM-DD".
	 */
	transactions(input: { accountId: string; from: string; to: string }): Promise<PluggyTransactionsResult>;
	/**
	 * `GET /investments?itemId=`: todas as páginas (docs.pluggy.ai/reference/investments-list). Lista vazia é resposta
	 * válida. Conector sem o produto pode recusar (403/404): quem chama decide; use `readInvestments` para não lançar.
	 */
	investments(itemId: string): Promise<PluggyInvestmentsResult>;
	/**
	 * `GET /investments/{id}/transactions`: todas as páginas. A referência só documenta `page` e `pageSize` (não há
	 * filtro por data), então vem o histórico inteiro que o Pluggy tiver.
	 */
	investmentTransactions(investmentId: string): Promise<PluggyInvestmentTransactionsResult>;
}

const PAGE_SIZE = 500;
/** Trava contra laço infinito se o Pluggy mentir sobre `totalPages` (500 × 40 = 20 mil lançamentos). */
const MAX_PAGES = 40;
/** Teto de uso de uma apiKey (a validade real vem do `exp` do JWT; ver `expiryOf`). */
const API_KEY_TTL_MS = 100 * 60_000;
/** Folga antes do `exp` para não mandar uma chave que vence no caminho. */
const API_KEY_SKEW_MS = 60_000;

/** Quando a apiKey (um JWT, segundo o SDK) vence. `null` se não der para ler o `exp`. */
function expiryOf(apiKey: string): number | null {
	try {
		const payload = JSON.parse(Buffer.from(apiKey.split(".")[1] ?? "", "base64url").toString("utf8")) as {
			exp?: unknown;
		};
		return typeof payload.exp === "number" && Number.isFinite(payload.exp) ? payload.exp * 1000 : null;
	} catch {
		return null;
	}
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CURSOR_PAGES = 400;
const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function statusToCode(status: number): PluggyErrorCode {
	if (status === 401) return "auth";
	if (status === 403) return "forbidden";
	if (status === 404) return "not_found";
	if (status === 429) return "rate_limit";
	return status >= 500 ? "unavailable" : "http";
}

/** Lê o corpo até `max` bytes; passou disso, desiste sem guardar o resto. */
async function readLimited(res: Response, max: number): Promise<string> {
	const declared = Number(res.headers.get("content-length"));
	if (Number.isFinite(declared) && declared > max) throw pluggyError("too_large");
	if (!res.body) {
		const text = await res.text();
		if (text.length > max) throw pluggyError("too_large");
		return text;
	}
	const reader = res.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > max) {
			await reader.cancel().catch(() => {});
			throw pluggyError("too_large");
		}
		chunks.push(value);
	}
	return Buffer.concat(chunks).toString("utf8");
}

/**
 * Cliente mínimo do Pluggy. Garantias:
 * - só `api.pluggy.ai`, sem seguir redirecionamento (a apiKey não vai para outro lugar);
 * - timeout e limite de tamanho por resposta;
 * - toda resposta passa por Zod; formato inesperado vira `PluggyError("invalid_response")`;
 * - nenhum erro carrega corpo de resposta, URL, clientId, clientSecret ou apiKey.
 */
export function createPluggyClient(options: PluggyClientOptions): PluggyClient {
	const { fetch: doFetch, clientId, clientSecret } = options;
	const now = options.now ?? (() => new Date());
	const timeoutMs = options.timeoutMs ?? 20_000;
	const maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
	let cached: { apiKey: string; expiresAt: number } | null = null;

	async function send(path: string, init: RequestInit): Promise<unknown> {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			let res: Response;
			try {
				res = await doFetch(`${PLUGGY_BASE_URL}${path}`, {
					...init,
					redirect: "error",
					signal: controller.signal,
				});
			} catch (e) {
				if (e instanceof PluggyError) throw e;
				throw pluggyError(controller.signal.aborted ? "timeout" : "network");
			}
			if (!res.ok) {
				await res.body?.cancel().catch(() => {});
				throw pluggyError(statusToCode(res.status), res.status);
			}
			try {
				return JSON.parse(await readLimited(res, maxBytes));
			} catch (e) {
				if (e instanceof PluggyError) throw e;
				throw pluggyError(controller.signal.aborted ? "timeout" : "invalid_response");
			}
		} finally {
			clearTimeout(timer);
		}
	}

	function parse<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
		const result = schema.safeParse(body);
		if (!result.success) throw pluggyError("invalid_response");
		return result.data;
	}

	async function apiKey(force = false): Promise<string> {
		if (!force && cached && cached.expiresAt > now().getTime()) return cached.apiKey;
		const body = await send("/auth", {
			method: "POST",
			headers: { "content-type": "application/json", accept: "application/json" },
			body: JSON.stringify({ clientId, clientSecret, nonExpiring: false }),
		});
		const { apiKey: key } = parse(authResponse, body);
		const cap = now().getTime() + API_KEY_TTL_MS;
		const exp = expiryOf(key);
		cached = { apiKey: key, expiresAt: exp === null ? cap : Math.min(cap, exp - API_KEY_SKEW_MS) };
		return key;
	}

	/** Pedido autenticado. Se a apiKey for recusada (venceu antes do previsto), renova uma vez. */
	async function authed(path: string, method: "GET" | "POST", json?: unknown): Promise<unknown> {
		const call = async (force: boolean) =>
			send(path, {
				method,
				headers: {
					"x-api-key": await apiKey(force),
					accept: "application/json",
					...(json === undefined ? {} : { "content-type": "application/json" }),
				},
				...(json === undefined ? {} : { body: JSON.stringify(json) }),
			});
		try {
			return await call(false);
		} catch (e) {
			if (e instanceof PluggyError && e.code === "auth" && cached !== null) {
				cached = null;
				return call(true);
			}
			throw e;
		}
	}
	const get = (path: string) => authed(path, "GET");

	async function allPages<S extends z.ZodType>(path: string, params: Record<string, string>, item: S) {
		const out: z.infer<S>[] = [];
		const schema = page(item);
		for (let n = 1; n <= MAX_PAGES; n++) {
			const query = new URLSearchParams({ ...params, page: String(n), pageSize: String(PAGE_SIZE) });
			const body = parse(schema, await get(`${path}?${query}`));
			out.push(...body.results);
			if (n >= body.totalPages || body.results.length === 0) return out;
		}
		throw pluggyError("too_large");
	}

	/**
	 * Como `allPages`, mas tolerante por linha: o envelope é rígido, cada linha é validada sozinha e a que não passa
	 * é descartada e contada (nunca logada: o conteúdo é dado de terceiro).
	 */
	async function allPagesLenient<S extends z.ZodType>(
		path: string,
		params: Record<string, string>,
		item: S,
	): Promise<{ rows: z.infer<S>[]; dropped: number }> {
		const rows: z.infer<S>[] = [];
		let dropped = 0;
		const schema = page(z.unknown());
		for (let n = 1; n <= MAX_PAGES; n++) {
			const query = new URLSearchParams({ ...params, page: String(n), pageSize: String(PAGE_SIZE) });
			const body = parse(schema, await get(`${path}?${query}`));
			for (const raw of body.results) {
				const row = item.safeParse(raw);
				if (row.success) rows.push(row.data);
				else dropped += 1;
			}
			if (n >= body.totalPages || body.results.length === 0) return { rows, dropped };
		}
		throw pluggyError("too_large");
	}

	/**
	 * Todas as páginas de um endpoint por cursor. Só o parâmetro `after` do `next` é aproveitado: o host nunca vem da
	 * resposta. O envelope (`results`, `next`) é rígido; cada linha é validada sozinha e a que não passa é descartada
	 * e contada (nunca logada: o conteúdo é dado de terceiro).
	 */
	async function allCursorPages<S extends z.ZodType>(
		path: string,
		params: Record<string, string>,
		item: S,
	): Promise<{ rows: z.infer<S>[]; dropped: number }> {
		const rows: z.infer<S>[] = [];
		let dropped = 0;
		const schema = cursorPage(z.unknown());
		let after: string | null = null;
		for (let n = 1; n <= MAX_CURSOR_PAGES; n++) {
			const query: URLSearchParams = new URLSearchParams(after === null ? params : { ...params, after });
			const body = parse(schema, await get(`${path}?${query}`));
			for (const raw of body.results) {
				const row = item.safeParse(raw);
				if (row.success) rows.push(row.data);
				else dropped += 1;
			}
			if (body.next === null || body.results.length === 0) return { rows, dropped };
			let next: string | null = null;
			try {
				next = new URL(body.next, PLUGGY_BASE_URL).searchParams.get("after");
			} catch {
				next = null;
			}
			// Sem cursor, ou o mesmo de antes: a resposta está errada, não adianta insistir.
			if (!next || next === after) throw pluggyError("invalid_response");
			after = next;
		}
		throw pluggyError("too_large");
	}

	// Entram no caminho da URL: só caracteres seguros (nunca "/", "?" ou "..").
	const needUuid = (value: string) => {
		if (!UUID.test(value)) throw new RangeError("o ID da conexão deve ser um UUID");
		return value;
	};
	const needSafeId = (value: string) => {
		if (!SAFE_ID.test(value)) throw new RangeError("ID de conta inválido");
		return value;
	};

	return {
		async connectToken(clientUserId, updateItemId) {
			if (!SAFE_ID.test(clientUserId)) throw new RangeError("clientUserId inválido");
			const body = await authed("/connect_token", "POST", {
				...(updateItemId === undefined ? {} : { itemId: needUuid(updateItemId) }),
				options: { clientUserId },
			});
			return parse(connectTokenResponse, body).accessToken;
		},
		async item(itemId) {
			return parse(itemResponse, await get(`/items/${needUuid(itemId)}`));
		},
		async accounts(itemId) {
			return allPages("/accounts", { itemId: needUuid(itemId) }, accountSchema);
		},
		async bills(accountId) {
			return allPages("/bills", { accountId: needSafeId(accountId) }, billSchema);
		},
		async categories() {
			return allPages("/categories", {}, categorySchema);
		},
		async transactions({ accountId, from, to }) {
			if (!DATE.test(from) || !DATE.test(to)) throw new RangeError("datas devem ser AAAA-MM-DD");
			const { rows, dropped } = await allCursorPages(
				"/v2/transactions",
				{ accountId: needSafeId(accountId), dateFrom: from, dateTo: to },
				transactionSchema,
			);
			return { transactions: rows, dropped };
		},
		async investments(itemId) {
			const { rows, dropped } = await allPagesLenient(
				"/investments",
				{ itemId: needUuid(itemId) },
				investmentSchema,
			);
			return { investments: rows, dropped };
		},
		async investmentTransactions(investmentId) {
			const { rows, dropped } = await allPagesLenient(
				`/investments/${needSafeId(investmentId)}/transactions`,
				{},
				investmentTransactionSchema,
			);
			return { transactions: rows, dropped };
		},
	};
}
