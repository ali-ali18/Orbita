import { DataError, type DataErrorCode } from "@orbita/db";
import type { ApiError } from "@orbita/shared";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";

export function apiError(code: string, message: string): ApiError {
	return { error: { code, message } };
}

export function notFoundHandler(c: Context) {
	return c.json(apiError("nao_encontrado", "Rota não encontrada."), 404);
}

const DATA_ERROR_HTTP = {
	invalid: { status: 400, code: "dados_invalidos" },
	not_found: { status: 404, code: "nao_encontrado" },
	duplicate: { status: 409, code: "conflito" },
	bad_reference: { status: 422, code: "referencia_invalida" },
} as const satisfies Record<DataErrorCode, { status: 400 | 404 | 409 | 422; code: string }>;

export function errorHandler(err: Error, c: Context) {
	// As mensagens dos stores já são pt-BR e feitas para o usuário.
	if (err instanceof DataError) {
		const { status, code } = DATA_ERROR_HTTP[err.code];
		return c.json(apiError(code, err.message), status);
	}
	// Rede de segurança: o engine lança RangeError/TypeError para entrada fora do alcance. A validação das
	// bordas deve pegar antes; se escapar, é pedido ruim (400), sem repassar o texto interno.
	if (err instanceof RangeError || err instanceof TypeError) {
		console.error(err);
		return c.json(
			apiError("dados_invalidos", "Algum dado informado está fora do que o sistema aceita."),
			400,
		);
	}
	// O Hono lança 400 para JSON malformado; qualquer outro status HTTP é nosso e já é genérico.
	if (err instanceof HTTPException && err.status === 400) {
		return c.json(apiError("dados_invalidos", "O corpo do pedido não é um JSON válido."), 400);
	}
	// Só o log do servidor vê o detalhe; o app recebe uma mensagem genérica.
	console.error(err);
	return c.json(apiError("erro_interno", "Algo deu errado no servidor."), 500);
}

/** Resposta 404 para "não existe" (`what` no feminino por padrão: "Conta" → "Conta não encontrada."). */
export function orNotFound<T>(value: T | null | undefined, what: string, ending: "a" | "o" = "a"): T {
	if (value === null || value === undefined) {
		throw new DataError("not_found", `${what} não encontrad${ending}.`);
	}
	return value;
}

/** Tira as chaves `undefined`: com `exactOptionalPropertyTypes`, o resultado de Zod não casa direto com os stores. */
export function defined<T extends object>(value: T): { [K in keyof T]: Exclude<T[K], undefined> } {
	return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as {
		[K in keyof T]: Exclude<T[K], undefined>;
	};
}
