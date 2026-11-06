import { zValidator } from "@hono/zod-validator";
import type { ZodType } from "zod";
import { apiError } from "./errors.ts";

/** Valida `json`, `query` ou `param` com Zod; erro vira 400 com a primeira mensagem do schema. */
export const validate = <Target extends "json" | "query" | "param", Schema extends ZodType>(
	target: Target,
	schema: Schema,
) =>
	zValidator(target, schema, (result, c) => {
		if (!result.success) {
			return c.json(apiError("dados_invalidos", result.error.issues[0]?.message ?? "Dados inválidos."), 400);
		}
	});
