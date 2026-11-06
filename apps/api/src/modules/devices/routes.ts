import { Hono } from "hono";
import { type AppEnv, createRequireDevice } from "../../http/require-device.ts";
import type { PairingDeps } from "../pairing/service.ts";
import { toDeviceDto } from "./dto.ts";

export function routes(deps: PairingDeps) {
	const requireDevice = createRequireDevice(deps);
	return new Hono<AppEnv>()
		.get("/v1/me", requireDevice, (c) => c.json({ device: toDeviceDto(c.get("device")) }))
		.delete("/v1/devices/current", requireDevice, async (c) => {
			await deps.store.revokeDevice({ deviceId: c.get("device").id, now: deps.now() });
			return c.body(null, 204);
		});
}
