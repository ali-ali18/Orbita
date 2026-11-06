import { ApiError, UNREACHABLE_MESSAGE } from "./api.ts";

/** Estado de um bloco da tela: nunca confundir "carregando" ou "falhou" com "vazio". */
export type Loadable<T> =
	| { phase: "loading" }
	| { phase: "error"; message: string; retry: () => void }
	| { phase: "ready"; data: T };

export interface QueryLike<T> {
	data: T | undefined;
	error: unknown;
	isPending: boolean;
	isError: boolean;
	fetchStatus: "fetching" | "paused" | "idle";
	refetch: () => unknown;
}

export function errorMessage(error: unknown): string {
	return error instanceof ApiError ? error.message : "Algo deu errado. Tente de novo.";
}

export function toLoadable<T>(q: QueryLike<T>): Loadable<T> {
	const retry = () => void q.refetch();
	// Já tem dado: mostra, mesmo que uma atualização em segundo plano tenha falhado.
	if (q.data !== undefined) return { phase: "ready", data: q.data };
	if (q.isError) return { phase: "error", message: errorMessage(q.error), retry };
	// Sem rede a consulta fica pausada para sempre: isso é falha, não "carregando".
	if (q.isPending && q.fetchStatus === "paused")
		return { phase: "error", message: UNREACHABLE_MESSAGE, retry };
	return { phase: "loading" };
}

/** Junta blocos que dependem de mais de uma consulta. Erro de qualquer um vence; "tentar de novo" refaz todos. */
export function combineLoadables<A, B>(a: Loadable<A>, b: Loadable<B>): Loadable<[A, B]> {
	if (a.phase === "error" || b.phase === "error") {
		const failed = a.phase === "error" ? a : (b as Extract<Loadable<B>, { phase: "error" }>);
		return {
			phase: "error",
			message: failed.message,
			retry: () => {
				if (a.phase === "error") a.retry();
				if (b.phase === "error") b.retry();
			},
		};
	}
	if (a.phase === "loading" || b.phase === "loading") return { phase: "loading" };
	return { phase: "ready", data: [a.data, b.data] };
}
