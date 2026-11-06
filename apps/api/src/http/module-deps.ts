import type { Stores } from "@orbita/db";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "./require-device.ts";

/** O que todo módulo de finanças recebe: stores, relógio e o guarda de aparelho. */
export type ModuleDeps = {
	stores: Stores;
	now: () => Date;
	requireDevice: MiddlewareHandler<AppEnv>;
};
