import { accountCreateBody, accountUpdateBody, idParam } from "@orbita/shared";
import { Hono } from "hono";
import { defined, orNotFound } from "../../http/errors.ts";
import type { ModuleDeps } from "../../http/module-deps.ts";
import type { AppEnv } from "../../http/require-device.ts";
import { validate } from "../../http/validate.ts";
import { toAccountDto } from "./dto.ts";

export function routes({ stores, requireDevice }: ModuleDeps) {
	const { accounts } = stores;
	return new Hono<AppEnv>()
		.use("/v1/accounts", requireDevice)
		.use("/v1/accounts/*", requireDevice)
		.get("/v1/accounts", async (c) => c.json({ accounts: (await accounts.list()).map(toAccountDto) }))
		.post("/v1/accounts", validate("json", accountCreateBody), async (c) => {
			const account = await accounts.create(defined(c.req.valid("json")));
			return c.json({ account: toAccountDto(account) }, 201);
		})
		.get("/v1/accounts/:id", validate("param", idParam), async (c) => {
			const account = orNotFound(await accounts.get(c.req.valid("param").id), "Conta");
			return c.json({ account: toAccountDto(account) });
		})
		.patch(
			"/v1/accounts/:id",
			validate("param", idParam),
			validate("json", accountUpdateBody),
			async (c) => {
				const account = await accounts.update(c.req.valid("param").id, defined(c.req.valid("json")));
				return c.json({ account: toAccountDto(account) });
			},
		)
		.delete("/v1/accounts/:id", validate("param", idParam), async (c) => {
			const account = await accounts.archive(c.req.valid("param").id);
			return c.json({ account: toAccountDto(account) });
		});
}
