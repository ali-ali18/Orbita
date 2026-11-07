import type { PairingClaimResponse } from "@orbita/shared";
import { hc, type InferResponseType } from "hono/client";
// Só o TIPO da API: `import type` some na compilação, então nenhum código de servidor entra no app.
import type { AppType } from "../../../api/src/app.ts";

export class ApiError extends Error {
	readonly status: number | null;
	readonly code: string;
	constructor(message: string, status: number | null, code: string) {
		super(message);
		this.name = "ApiError";
		this.status = status;
		this.code = code;
	}
}

export const UNREACHABLE_MESSAGE = "Não consegui falar com o servidor. Confira o endereço e a sua conexão.";
const NOT_ORBITA_MESSAGE = "Esse endereço respondeu, mas não parece ser um servidor Órbita.";

export function createApi(baseUrl: string, token?: string) {
	return hc<AppType>(baseUrl, token ? { headers: { Authorization: `Bearer ${token}` } } : {});
}
export type Api = ReturnType<typeof createApi>;

type JsonLike = { json(): Promise<unknown>; ok: boolean; status: number };

function errorFrom(body: unknown): { code: string; message: string } | null {
	if (typeof body !== "object" || body === null || !("error" in body)) return null;
	const { error } = body as { error: unknown };
	if (typeof error !== "object" || error === null) return null;
	const { code, message } = error as { code?: unknown; message?: unknown };
	return typeof message === "string" ? { code: typeof code === "string" ? code : "erro", message } : null;
}

/**
 * Chama a API e devolve o corpo já tipado. Falha com `ApiError` carregando a mensagem em pt-BR
 * que a própria API manda (`{ error: { code, message } }`); rede fora do ar vira mensagem amiga.
 */
export async function call<R extends JsonLike>(
	request: () => Promise<R>,
): Promise<Exclude<Awaited<ReturnType<R["json"]>>, { error: unknown }>> {
	let res: R;
	try {
		res = await request();
	} catch {
		throw new ApiError(UNREACHABLE_MESSAGE, null, "sem_conexao");
	}
	let body: unknown;
	try {
		body = await res.json();
	} catch {
		throw new ApiError(
			res.ok ? NOT_ORBITA_MESSAGE : `${NOT_ORBITA_MESSAGE} (HTTP ${res.status})`,
			res.status,
			"resposta_invalida",
		);
	}
	if (!res.ok) {
		const known = errorFrom(body);
		throw new ApiError(known?.message ?? NOT_ORBITA_MESSAGE, res.status, known?.code ?? "erro");
	}
	return body as Exclude<Awaited<ReturnType<R["json"]>>, { error: unknown }>;
}

/** Troca o código de 6 dígitos por um token do aparelho. Não precisa de token. */
export function claimPairing(
	baseUrl: string,
	code: string,
	deviceName: string,
): Promise<PairingClaimResponse> {
	const api = createApi(baseUrl);
	return call(() =>
		api.v1.pairing.claim.$post({ json: { code, deviceName } }),
	) as Promise<PairingClaimResponse>;
}

export type MonthSummary = InferResponseType<Api["v1"]["summary"][":month"]["$get"], 200>;
export type InvoiceView = InferResponseType<Api["v1"]["cards"][":id"]["invoices"][":month"]["$get"], 200>;
export type InstallmentsView = InferResponseType<Api["v1"]["installments"]["$get"], 200>;
export type RecentTransactions = InferResponseType<Api["v1"]["transactions"]["$get"], 200>;
export type CategoriesView = InferResponseType<Api["v1"]["categories"]["$get"], 200>;
export type CardsView = InferResponseType<Api["v1"]["cards"]["$get"], 200>;
export type AccountsView = InferResponseType<Api["v1"]["accounts"]["$get"], 200>;
export type TransactionView = InferResponseType<Api["v1"]["transactions"][":id"]["$get"], 200>;
