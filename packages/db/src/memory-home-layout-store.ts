import { type HomeLayout, reconcileHomeLayout } from "@orbita/shared";
import { cleanHomeLayout } from "./home-layout-rules.ts";
import type { HomeLayoutStore } from "./home-layout-store.ts";

export function createMemoryHomeLayoutStore(): HomeLayoutStore {
	let stored: HomeLayout | null = null;
	const copy = (items: HomeLayout): HomeLayout => items.map((i) => ({ ...i }));
	return {
		async get() {
			return copy(reconcileHomeLayout(stored));
		},
		async set(items) {
			stored = copy(cleanHomeLayout(items));
			return copy(stored);
		},
	};
}
