import { idParam, recurrenceCreateBody, recurrencePostBody, recurrenceUpdateBody } from "@orbita/shared";
import { Hono } from "hono";
import { defined, orNotFound } from "../../http/errors.ts";
import type { ModuleDeps } from "../../http/module-deps.ts";
import type { AppEnv } from "../../http/require-device.ts";
import { validate } from "../../http/validate.ts";
import { toTransactionDto } from "../transactions/dto.ts";
import { toPostingDto, toRecurrenceDto } from "./dto.ts";
import { postRecurrence } from "./service.ts";

export function routes({ stores, requireDevice }: ModuleDeps) {
	const { recurrences } = stores;
	return new Hono<AppEnv>()
		.use("/v1/recurrences", requireDevice)
		.use("/v1/recurrences/*", requireDevice)
		.get("/v1/recurrences", async (c) =>
			c.json({ recurrences: (await recurrences.list()).map(toRecurrenceDto) }),
		)
		.post("/v1/recurrences", validate("json", recurrenceCreateBody), async (c) => {
			const recurrence = await recurrences.create(defined(c.req.valid("json")));
			return c.json({ recurrence: toRecurrenceDto(recurrence) }, 201);
		})
		.get("/v1/recurrences/:id", validate("param", idParam), async (c) => {
			const recurrence = orNotFound(await recurrences.get(c.req.valid("param").id), "Recorrência");
			return c.json({ recurrence: toRecurrenceDto(recurrence) });
		})
		.patch(
			"/v1/recurrences/:id",
			validate("param", idParam),
			validate("json", recurrenceUpdateBody),
			async (c) => {
				const recurrence = await recurrences.update(c.req.valid("param").id, defined(c.req.valid("json")));
				return c.json({ recurrence: toRecurrenceDto(recurrence) });
			},
		)
		.delete("/v1/recurrences/:id", validate("param", idParam), async (c) => {
			const recurrence = await recurrences.archive(c.req.valid("param").id);
			return c.json({ recurrence: toRecurrenceDto(recurrence) });
		})
		.post(
			"/v1/recurrences/:id/post",
			validate("param", idParam),
			validate("json", recurrencePostBody),
			async (c) => {
				const { transaction, posting } = await postRecurrence(
					stores,
					c.req.valid("param").id,
					c.req.valid("json"),
				);
				return c.json({ transaction: toTransactionDto(transaction), posting: toPostingDto(posting) }, 201);
			},
		);
}
