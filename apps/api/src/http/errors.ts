import type { ApiError } from "@orbita/shared";
import type { Context } from "hono";

export function apiError(code: string, message: string): ApiError {
	return { error: { code, message } };
}

export function notFoundHandler(c: Context) {
	return c.json(apiError("nao_encontrado", "Rota não encontrada."), 404);
}

export function errorHandler(err: Error, c: Context) {
	// Só o log do servidor vê o detalhe; o app recebe uma mensagem genérica.
	console.error(err);
	return c.json(apiError("erro_interno", "Algo deu errado no servidor."), 500);
}
