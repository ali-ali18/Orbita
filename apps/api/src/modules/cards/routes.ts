import { cardCreateBody, cardUpdateBody, idParam } from "@orbita/shared";
import { Hono } from "hono";
import { defined, orNotFound } from "../../http/errors.ts";
import type { ModuleDeps } from "../../http/module-deps.ts";
import type { AppEnv } from "../../http/require-device.ts";
import { validate } from "../../http/validate.ts";
import { toCardDto } from "./dto.ts";

export function routes({ stores, requireDevice }: ModuleDeps) {
	const { cards } = stores;
	return new Hono<AppEnv>()
		.use("/v1/cards", requireDevice)
		.use("/v1/cards/*", requireDevice)
		.get("/v1/cards", async (c) => c.json({ cards: (await cards.list()).map(toCardDto) }))
		.post("/v1/cards", validate("json", cardCreateBody), async (c) => {
			const card = await cards.create(defined(c.req.valid("json")));
			return c.json({ card: toCardDto(card) }, 201);
		})
		.get("/v1/cards/:id", validate("param", idParam), async (c) => {
			const card = orNotFound(await cards.get(c.req.valid("param").id), "Cartão", "o");
			return c.json({ card: toCardDto(card) });
		})
		.patch("/v1/cards/:id", validate("param", idParam), validate("json", cardUpdateBody), async (c) => {
			const card = await cards.update(c.req.valid("param").id, defined(c.req.valid("json")));
			return c.json({ card: toCardDto(card) });
		})
		.delete("/v1/cards/:id", validate("param", idParam), async (c) => {
			const card = await cards.archive(c.req.valid("param").id);
			return c.json({ card: toCardDto(card) });
		});
}
