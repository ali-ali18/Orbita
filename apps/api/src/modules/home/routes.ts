import { homeLayoutBody } from "@orbita/shared";
import { Hono } from "hono";
import type { ModuleDeps } from "../../http/module-deps.ts";
import type { AppEnv } from "../../http/require-device.ts";
import { validate } from "../../http/validate.ts";

/** Layout dos widgets do Início: ordem, tamanho e visibilidade, guardados no servidor. Só configuração. */
export function routes({ stores, requireDevice }: ModuleDeps) {
	const { homeLayout } = stores;
	return new Hono<AppEnv>()
		.use("/v1/home/layout", requireDevice)
		.get("/v1/home/layout", async (c) => c.json({ items: await homeLayout.get() }))
		.put("/v1/home/layout", validate("json", homeLayoutBody), async (c) =>
			c.json({ items: await homeLayout.set(c.req.valid("json").items) }),
		);
}
