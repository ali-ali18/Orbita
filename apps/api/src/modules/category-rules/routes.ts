import { categoryRuleCreateBody, idParam } from "@orbita/shared";
import { Hono } from "hono";
import { orNotFound } from "../../http/errors.ts";
import type { ModuleDeps } from "../../http/module-deps.ts";
import type { AppEnv } from "../../http/require-device.ts";
import { validate } from "../../http/validate.ts";
import { toCategoryRuleDto } from "./dto.ts";
import { createCategoryRule } from "./service.ts";

export function routes({ stores, requireDevice }: ModuleDeps) {
	const { categoryRules } = stores;
	return new Hono<AppEnv>()
		.use("/v1/category-rules", requireDevice)
		.use("/v1/category-rules/*", requireDevice)
		.get("/v1/category-rules", async (c) =>
			c.json({ rules: (await categoryRules.list()).map(toCategoryRuleDto) }),
		)
		.post("/v1/category-rules", validate("json", categoryRuleCreateBody), async (c) => {
			const { rule, updated } = await createCategoryRule(stores, c.req.valid("json"));
			return c.json({ rule: toCategoryRuleDto(rule), updated }, 201);
		})
		.delete("/v1/category-rules/:id", validate("param", idParam), async (c) => {
			const { id } = c.req.valid("param");
			orNotFound((await categoryRules.delete(id)) || null, "Regra");
			return c.json({ deleted: true });
		});
}
