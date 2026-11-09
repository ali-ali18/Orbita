import { reconcileHomeLayout } from "@orbita/shared";
import type { Db } from "./client.ts";
import { cleanHomeLayout } from "./home-layout-rules.ts";
import type { HomeLayoutStore } from "./home-layout-store.ts";

const ID = "main";

export function createPrismaHomeLayoutStore(db: Db): HomeLayoutStore {
	return {
		async get() {
			const row = await db.homeLayout.findUnique({ where: { id: ID } });
			return reconcileHomeLayout(Array.isArray(row?.items) ? row.items : null);
		},
		async set(items) {
			const clean = cleanHomeLayout(items);
			await db.homeLayout.upsert({
				where: { id: ID },
				update: { items: clean },
				create: { id: ID, items: clean },
			});
			return clean;
		},
	};
}
