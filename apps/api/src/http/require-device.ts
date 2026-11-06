import type { DeviceRecord } from "@orbita/db";
import { createMiddleware } from "hono/factory";
import { authenticateDevice, type PairingDeps } from "../modules/pairing/service.ts";
import { apiError } from "./errors.ts";

export type AppEnv = { Variables: { device: DeviceRecord } };

/** Exige `Authorization: Bearer orb_...` de um aparelho não revogado. */
export function createRequireDevice(deps: PairingDeps) {
	return createMiddleware<AppEnv>(async (c, next) => {
		const header = c.req.header("authorization") ?? "";
		const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
		const device = token ? await authenticateDevice(deps, token) : null;
		if (!device)
			return c.json(apiError("nao_autorizado", "Este aparelho não está conectado. Pareie de novo."), 401);
		c.set("device", device);
		await next();
	});
}
