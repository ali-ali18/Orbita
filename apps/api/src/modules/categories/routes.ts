import { categoryCreateBody, categoryUpdateBody, idParam } from "@orbita/shared";
import { Hono } from "hono";
import { defined, orNotFound } from "../../http/errors.ts";
import type { ModuleDeps } from "../../http/module-deps.ts";
import type { AppEnv } from "../../http/require-device.ts";
import { validate } from "../../http/validate.ts";
import { toCategoryDto } from "./dto.ts";

export function routes({ stores, requireDevice }: ModuleDeps) {
	const { categories } = stores;
	return new Hono<AppEnv>()
		.use("/v1/categories", requireDevice)
		.use("/v1/categories/*", requireDevice)
		.get("/v1/categories", async (c) => c.json({ categories: (await categories.list()).map(toCategoryDto) }))
		.post("/v1/categories", validate("json", categoryCreateBody), async (c) => {
			const category = await categories.create(defined(c.req.valid("json")));
			return c.json({ category: toCategoryDto(category) }, 201);
		})
		.get("/v1/categories/:id", validate("param", idParam), async (c) => {
			const category = orNotFound(await categories.get(c.req.valid("param").id), "Categoria");
			return c.json({ category: toCategoryDto(category) });
		})
		.patch(
			"/v1/categories/:id",
			validate("param", idParam),
			validate("json", categoryUpdateBody),
			async (c) => {
				const category = await categories.update(c.req.valid("param").id, defined(c.req.valid("json")));
				return c.json({ category: toCategoryDto(category) });
			},
		)
		.delete("/v1/categories/:id", validate("param", idParam), async (c) => {
			const category = await categories.archive(c.req.valid("param").id);
			return c.json({ category: toCategoryDto(category) });
		});
}
