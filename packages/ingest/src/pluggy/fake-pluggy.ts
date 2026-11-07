import type { PluggyFetch } from "./client.ts";

/*
 * Pluggy de mentira para os testes: responde no formato da API (campos como no JSON real; ver docs/pluggy.md),
 * pagina e registra os pedidos. Sem rede.
 */

export const CLIENT_ID = "aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb";
export const CLIENT_SECRET = "cccccccc-2222-4333-8444-dddddddddddd";
export const API_KEY = "eyJhbGciOiJIUzI1NiJ9.fake-api-key-payload.fake-signature";
export const CONNECT_TOKEN = "eyJhbGciOiJIUzI1NiJ9.fake-connect-token-payload.fake-connect-signature";
export const ITEM_ID = "123e4567-e89b-42d3-a456-426614174000";
export const BANK_ACCOUNT_ID = "0f1d2c3b-aaaa-4bbb-8ccc-000000000001";
export const CARD_ACCOUNT_ID = "0f1d2c3b-aaaa-4bbb-8ccc-000000000002";

export const bankAccount = {
	id: BANK_ACCOUNT_ID,
	type: "BANK",
	subtype: "CHECKING_ACCOUNT",
	name: "Conta Corrente",
	marketingName: null,
	number: "12345-6",
	owner: "FULANO DE TAL",
	taxNumber: "123.456.789-00",
	balance: 1520.35,
	currencyCode: "BRL",
	itemId: ITEM_ID,
	bankData: { transferNumber: "0001/12345-6" },
	creditData: null,
};

export const cardAccount = {
	id: CARD_ACCOUNT_ID,
	type: "CREDIT",
	subtype: "CREDIT_CARD",
	name: "Cartão Mastercard Gold",
	marketingName: "Mastercard Gold",
	number: "5502 **** **** 4321",
	owner: "FULANO DE TAL",
	taxNumber: "123.456.789-00",
	balance: 830.1,
	currencyCode: "BRL",
	itemId: ITEM_ID,
	creditData: {
		level: "GOLD",
		brand: "MASTERCARD",
		balanceCloseDate: "2026-11-10T00:00:00.000Z",
		balanceDueDate: "2026-11-17T00:00:00.000Z",
		creditLimit: 5000,
		availableCreditLimit: 4169.9,
	},
};

type Json = Record<string, unknown>;

export function tx(id: string, extra: Json): Json {
	return {
		id,
		description: "Padaria",
		descriptionRaw: "PADARIA SAO JOAO",
		currencyCode: "BRL",
		amount: 10,
		amountInAccountCurrency: null,
		date: "2026-11-03T00:00:00.000Z",
		category: "Eating out",
		categoryId: "08000000",
		status: "POSTED",
		type: "DEBIT",
		operationType: null,
		paymentData: null,
		providerCode: null,
		creditCardMetadata: null,
		...extra,
	};
}

export interface FakePluggyOptions {
	item?: Json | (() => Json);
	accounts?: Json[];
	/** Por accountId. */
	transactions?: Record<string, Json[]>;
	/** Faturas por accountId do cartão (`GET /bills`). Ausente = 404, como num conector sem faturas. */
	bills?: Record<string, Json[]>;
	/** Árvore de categorias (`GET /categories`). Ausente = 404. */
	categories?: Json[];
	/** Lançamentos por página do cursor (padrão: `pageSize`). */
	cursorPageSize?: number;
	pageSize?: number;
	/** Dá resposta própria para um caminho (ex.: erro). */
	override?: (url: URL, init: RequestInit) => Response | undefined;
}

export interface RecordedRequest {
	method: string;
	url: URL;
	headers: Record<string, string>;
	body: string | undefined;
}

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export function fakePluggy(options: FakePluggyOptions = {}) {
	const requests: RecordedRequest[] = [];
	const pageSize = options.pageSize ?? 500;
	const paged = (all: Json[], url: URL) => {
		const page = Number(url.searchParams.get("page") ?? "1");
		const size = Math.min(Number(url.searchParams.get("pageSize") ?? pageSize), pageSize);
		return json({
			total: all.length,
			totalPages: Math.max(1, Math.ceil(all.length / size)),
			page,
			results: all.slice((page - 1) * size, page * size),
		});
	};
	const fetch: PluggyFetch = async (rawUrl, init) => {
		const url = new URL(rawUrl);
		requests.push({
			method: init.method ?? "GET",
			url,
			headers: { ...(init.headers as Record<string, string>) },
			body: typeof init.body === "string" ? init.body : undefined,
		});
		const custom = options.override?.(url, init);
		if (custom) return custom;
		if (url.pathname === "/auth") {
			const body = JSON.parse(String(init.body)) as { clientId?: string; clientSecret?: string };
			return body.clientId === CLIENT_ID && body.clientSecret === CLIENT_SECRET
				? json({ apiKey: API_KEY })
				: json({ message: `Invalid credentials ${body.clientSecret}` }, 401);
		}
		const key = (init.headers as Record<string, string>)["x-api-key"];
		if (key !== API_KEY) return json({ message: "Unauthorized" }, 401);
		if (url.pathname === "/connect_token" && init.method === "POST") {
			return json({ accessToken: CONNECT_TOKEN });
		}
		if (url.pathname === `/items/${ITEM_ID}`) {
			const item = typeof options.item === "function" ? options.item() : options.item;
			return json({
				id: ITEM_ID,
				status: "UPDATED",
				executionStatus: "SUCCESS",
				lastUpdatedAt: "2026-11-07T08:00:00.000Z",
				createdAt: "2026-11-01T08:00:00.000Z",
				connector: { id: 612, name: "Nubank", isSandbox: false },
				...item,
			});
		}
		if (url.pathname === "/accounts" && url.searchParams.get("itemId") === ITEM_ID) {
			return paged(options.accounts ?? [bankAccount, cardAccount], url);
		}
		if (url.pathname === "/categories") {
			return options.categories ? paged(options.categories, url) : json({ message: "Not found" }, 404);
		}
		if (url.pathname === "/bills") {
			const list = options.bills?.[url.searchParams.get("accountId") ?? ""];
			return list ? paged(list, url) : json({ message: "Not found" }, 404);
		}
		if (url.pathname === "/v2/transactions") {
			const list = options.transactions?.[url.searchParams.get("accountId") ?? ""];
			if (!list) return json({ message: "Account not found" }, 404);
			// Como o SDK: `dateFrom`/`dateTo` filtram pelo dia e `after` é o cursor (aqui, o índice em base64).
			const from = url.searchParams.get("dateFrom") ?? "0000-00-00";
			const to = url.searchParams.get("dateTo") ?? "9999-99-99";
			// Linhas que nem objeto são (lixo de teste) passam direto, para o cliente decidir.
			const inRange = list.filter((t) => {
				if (typeof t !== "object" || t === null) return true;
				const day = String(t.date).slice(0, 10);
				return day >= from && day <= to;
			});
			const size = options.cursorPageSize ?? pageSize;
			const start = Number(Buffer.from(url.searchParams.get("after") ?? "MA==", "base64").toString());
			const end = start + size;
			return json({
				results: inRange.slice(start, end),
				next:
					end < inRange.length
						? `/v2/transactions?accountId=x&after=${encodeURIComponent(Buffer.from(String(end)).toString("base64"))}`
						: null,
			});
		}
		return json({ message: "Not found" }, 404);
	};
	return { fetch, requests };
}
