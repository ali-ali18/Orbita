import { badReference, DataError } from "./errors.ts";

const codeOf = (e: unknown) => (e as { code?: unknown } | null)?.code;

/** Violação de unicidade (P2002). */
export const isUniqueViolation = (e: unknown) => codeOf(e) === "P2002";
/** Violação de chave estrangeira (P2003). */
export const isForeignKeyViolation = (e: unknown) => codeOf(e) === "P2003";
/** Registro a alterar não existe (P2025). */
export const isRecordMissing = (e: unknown) => codeOf(e) === "P2025";

/** Troca o erro do banco pelo `DataError` que a memória também lança. Outros erros seguem como estão. */
export function translate(e: unknown, onUnique: () => DataError): unknown {
	if (e instanceof DataError) return e;
	if (isUniqueViolation(e)) return onUnique();
	if (isForeignKeyViolation(e)) return badReference();
	return e;
}
