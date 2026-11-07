import { createMemoryStores, createSecretVault, type Stores } from "@orbita/db";
import { deriveKey } from "@orbita/security";
import { type AppDeps, createApp } from "./app.ts";
import { createPairingGuard } from "./modules/pairing/guard.ts";
import { createPairingCode, type PairingDeps } from "./modules/pairing/service.ts";

// biome-ignore lint/suspicious/noExplicitAny: corpo JSON de resposta, lido de forma solta nos testes
export type Json = any;

/** "Hoje" fixo: 15/11/2026, 12h em São Paulo. O mês tem 30 dias (16 restantes contando hoje). */
export const NOW = "2026-11-15T15:00:00Z";

/** App completo com stores em memória, relógio fixo e um aparelho já pareado. */
export async function setupFinance(
	nowIso = NOW,
	makeStores: (now: () => Date) => Stores = (now) => createMemoryStores({ now }),
	extraDeps: Partial<Pick<AppDeps, "pluggySyncQueue" | "pluggyFetch">> = {},
) {
	const now = () => new Date(nowIso);
	const stores = makeStores(now);
	await stores.categories.ensureDefaults();
	const deps: PairingDeps = {
		store: stores.auth,
		pairingKey: deriveKey("s".repeat(48), "pairing-code"),
		now,
	};
	const guard = createPairingGuard(() => now().getTime());
	const vault = createSecretVault({ store: stores.secrets, key: deriveKey("s".repeat(48), "secret-box") });
	const app = createApp({
		...deps,
		stores,
		guard,
		vault,
		version: "0.0.0-test",
		trustedProxyHops: 0,
		...extraDeps,
	});

	const { code } = await createPairingCode(deps);
	const claim = await app.request("/v1/pairing/claim", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ code, deviceName: "Teste" }),
	});
	const { token } = (await claim.json()) as { token: string };

	async function call(
		method: string,
		path: string,
		body?: unknown,
		auth: string | null = token,
	): Promise<{ status: number; body: Json }> {
		const headers: Record<string, string> = {};
		if (auth) headers.authorization = `Bearer ${auth}`;
		if (body !== undefined) headers["content-type"] = "application/json";
		const res = await app.request(path, {
			method,
			headers,
			...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
		});
		const text = await res.text();
		return { status: res.status, body: text ? JSON.parse(text) : null };
	}

	const api = {
		get: (path: string) => call("GET", path),
		post: (path: string, body?: unknown) => call("POST", path, body ?? {}),
		patch: (path: string, body: unknown) => call("PATCH", path, body),
		put: (path: string, body: unknown) => call("PUT", path, body),
		delete: (path: string) => call("DELETE", path),
	};

	/** Cria o que quase todo teste precisa: conta, cartão (fecha 10, vence 20) e categorias por slug. */
	async function basics() {
		const account = (await api.post("/v1/accounts", { name: "Conta", kind: "checking" })).body.account;
		const card = (await api.post("/v1/cards", { name: "Cartão", closingDay: 10, dueDay: 20 })).body.card;
		const cats = (await api.get("/v1/categories")).body.categories as { id: string; slug: string }[];
		const category = (slug: string) => cats.find((c) => c.slug === slug)?.id as string;
		return { account, card, category };
	}

	return { app, stores, vault, token, call, api, basics };
}
