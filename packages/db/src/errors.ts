export type DataErrorCode =
	/** Dado que não respeita uma regra (valor, formato, combinação de campos). */
	| "invalid"
	| "not_found"
	/** Viola uma unicidade (id externo repetido, recorrência já lançada no mês, slug em uso). */
	| "duplicate"
	/** Aponta para conta, cartão, categoria ou lançamento que não existe. */
	| "bad_reference";

/**
 * Erro de regra de dados. Os dois stores (Prisma e memória) lançam este mesmo tipo com a
 * mesma mensagem em pt-BR, pronta para a API mostrar ao usuário.
 */
export class DataError extends Error {
	readonly code: DataErrorCode;

	constructor(code: DataErrorCode, message: string) {
		super(message);
		this.name = "DataError";
		this.code = code;
	}
}

export const invalid = (message: string) => new DataError("invalid", message);
export const notFound = (what: string, ending: "a" | "o" = "a") =>
	new DataError("not_found", `${what} não encontrad${ending}.`);
export const badReference = () =>
	new DataError("bad_reference", "Conta, cartão, categoria ou lançamento informado não existe.");
