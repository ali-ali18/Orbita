import { createHash, generateKeyPairSync, type KeyObject } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryStores } from "@orbita/db";
import {
	buildManifest,
	formatSignatureHeader,
	signManifest,
	verifyManifestSignature,
	writeOtaDir,
} from "@orbita/ota";
import { deriveKey } from "@orbita/security";
import { describe, expect, it } from "vitest";
import { createApp } from "../../app.ts";
import { createPairingGuard } from "../pairing/guard.ts";
import { createSecretVault } from "../settings/service.ts";
import { routes } from "./routes.ts";
import { createFsOtaStore, createMemoryOtaStore } from "./store.ts";

const RUNTIME = "rt-test";
const KEY_ID = "orbita-ota";
const bytes = (s: string) => new TextEncoder().encode(s);
const PROTOCOL = {
	"expo-protocol-version": "1",
	"expo-platform": "android",
	"expo-runtime-version": RUNTIME,
};

type Published = { dir: string; publicKey: KeyObject; manifestJson: string; id: string; assetUrls: string[] };

/** Gera, assina e grava uma atualização de verdade (o mesmo caminho do CI), numa pasta temporária. */
async function publish(
	opts: { runtimeVersion?: string; corruptSignature?: boolean } = {},
): Promise<Published> {
	const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
	const built = buildManifest({
		runtimeVersion: opts.runtimeVersion ?? RUNTIME,
		createdAt: "2026-11-01T12:00:00.000Z",
		baseUrl: "https://financas.exemplo.dev",
		launch: { bytes: bytes("console.log('v1')") },
		assets: [{ key: "0123456789abcdef0123456789abcdef", ext: "png", bytes: bytes("png") }],
		expoClient: { name: "Órbita" },
	});
	const dir = await mkdtemp(join(tmpdir(), "orbita-ota-api-"));
	await writeOtaDir({
		outDir: dir,
		platform: "android",
		built,
		signatureHeader: formatSignatureHeader({
			signature: signManifest(built.json, privateKey),
			keyId: KEY_ID,
		}),
	});
	if (opts.corruptSignature) await writeFile(join(dir, "android", "manifest.signature"), "lixo\r\nx-evil: 1");
	return {
		dir,
		publicKey,
		manifestJson: built.json,
		id: built.manifest.id,
		assetUrls: [built.manifest.launchAsset.url, ...built.manifest.assets.map((a) => a.url)],
	};
}

function app(ota: ReturnType<typeof createFsOtaStore>, now = () => new Date("2026-11-07T12:00:00Z")) {
	return routes({ ota, now, trustedProxyHops: 0 });
}

const get = (a: ReturnType<typeof app>, path: string, headers: Record<string, string> = PROTOCOL) =>
	a.request(path, { headers });

/** Lê as partes de uma resposta multipart/mixed. */
function parseMultipart(contentType: string, body: string) {
	const boundary = /boundary=(.+)$/.exec(contentType)?.[1] ?? "";
	return body
		.split(`--${boundary}`)
		.filter((p) => p.trim() !== "" && p.trim() !== "--")
		.map((raw) => {
			const [head = "", ...rest] = raw.replace(/^\r\n/, "").split("\r\n\r\n");
			const headers = Object.fromEntries(
				head
					.split("\r\n")
					.map((l) => [l.slice(0, l.indexOf(":")).toLowerCase(), l.slice(l.indexOf(":") + 1).trim()]),
			);
			return { headers, body: rest.join("\r\n\r\n").replace(/\r\n$/, "") };
		});
}

describe("GET /updates/manifest", () => {
	it("runtime igual: multipart com o manifesto exato e a assinatura verificável", async () => {
		const p = await publish();
		const res = await get(app(createFsOtaStore(p.dir)), "/updates/manifest");
		expect(res.status).toBe(200);
		expect(res.headers.get("expo-protocol-version")).toBe("1");
		expect(res.headers.get("expo-sfv-version")).toBe("0");
		expect(res.headers.get("cache-control")).toBe("private, max-age=0");
		const contentType = res.headers.get("content-type") ?? "";
		expect(contentType).toMatch(/^multipart\/mixed; boundary=/);

		const [part, ...others] = parseMultipart(contentType, await res.text());
		expect(others).toHaveLength(0);
		expect(part?.headers["content-disposition"]).toBe('form-data; name="manifest"');
		expect(part?.headers["content-type"]).toContain("application/json");
		expect(part?.body).toBe(p.manifestJson);
		const header = part?.headers["expo-signature"] ?? "";
		expect(header).toContain(`keyid="${KEY_ID}"`);
		const signature = /sig="([^"]+)"/.exec(header)?.[1] ?? "";
		expect(verifyManifestSignature(part?.body ?? "", signature, p.publicKey)).toBe(true);
		expect(JSON.parse(part?.body ?? "").id).toBe(p.id);
	});

	it("Accept só com JSON: resposta única com expo-signature no cabeçalho", async () => {
		const p = await publish();
		const res = await get(app(createFsOtaStore(p.dir)), "/updates/manifest", {
			...PROTOCOL,
			accept: "application/expo+json, application/json",
		});
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("application/expo+json");
		expect(await res.text()).toBe(p.manifestJson);
		const signature = /sig="([^"]+)"/.exec(res.headers.get("expo-signature") ?? "")?.[1] ?? "";
		expect(verifyManifestSignature(p.manifestJson, signature, p.publicKey)).toBe(true);
	});

	it("runtime diferente: 204 sem atualização, com o cabeçalho do protocolo", async () => {
		const p = await publish();
		const res = await get(app(createFsOtaStore(p.dir)), "/updates/manifest", {
			...PROTOCOL,
			"expo-runtime-version": "outro-runtime",
		});
		expect(res.status).toBe(204);
		expect(res.headers.get("expo-protocol-version")).toBe("1");
		expect(await res.text()).toBe("");
	});

	it("app que já roda esta atualização (expo-current-update-id): 204", async () => {
		const p = await publish();
		const a = app(createFsOtaStore(p.dir));
		expect(
			(await get(a, "/updates/manifest", { ...PROTOCOL, "expo-current-update-id": p.id.toUpperCase() }))
				.status,
		).toBe(204);
		expect(
			(await get(a, "/updates/manifest", { ...PROTOCOL, "expo-current-update-id": "outro" })).status,
		).toBe(200);
	});

	it("iOS: válido no protocolo, mas sem atualização", async () => {
		const p = await publish();
		const res = await get(app(createFsOtaStore(p.dir)), "/updates/manifest", {
			...PROTOCOL,
			"expo-platform": "ios",
		});
		expect(res.status).toBe(204);
	});

	it("pedidos malformados", async () => {
		const a = app(createMemoryOtaStore());
		const { "expo-platform": _p, ...semPlataforma } = PROTOCOL;
		const { "expo-runtime-version": _r, ...semRuntime } = PROTOCOL;
		const { "expo-protocol-version": _v, ...semProtocolo } = PROTOCOL;
		expect((await get(a, "/updates/manifest", semPlataforma)).status).toBe(400);
		expect((await get(a, "/updates/manifest", { ...PROTOCOL, "expo-platform": "windows" })).status).toBe(400);
		expect((await get(a, "/updates/manifest", semRuntime)).status).toBe(400);
		expect(
			(await get(a, "/updates/manifest", { ...PROTOCOL, "expo-runtime-version": "x".repeat(300) })).status,
		).toBe(400);
		expect((await get(a, "/updates/manifest", semProtocolo)).status).toBe(406);
		expect((await get(a, "/updates/manifest", { ...PROTOCOL, "expo-protocol-version": "0" })).status).toBe(
			406,
		);
		expect((await get(a, "/updates/manifest", { ...PROTOCOL, accept: "text/html" })).status).toBe(406);
	});

	it("sem pasta OTA (imagem sem chave de assinatura): 204, não erro", async () => {
		const missing = join(tmpdir(), "orbita-ota-nao-existe");
		const res = await get(app(createFsOtaStore(missing)), "/updates/manifest");
		expect(res.status).toBe(204);
	});

	it("assinatura em formato estranho nunca vai para o cabeçalho: 204 e log", async () => {
		const p = await publish({ corruptSignature: true });
		const logs: string[] = [];
		const res = await get(app(createFsOtaStore(p.dir, (m) => logs.push(m))), "/updates/manifest");
		expect(res.status).toBe(204);
		expect(logs).toHaveLength(1);
	});

	it("limita pedidos por IP (429 com Retry-After) e a janela renova", async () => {
		let t = Date.parse("2026-11-07T12:00:00Z");
		const a = app(createMemoryOtaStore(), () => new Date(t));
		for (let i = 0; i < 60; i++) expect((await get(a, "/updates/manifest")).status).toBe(204);
		const blocked = await get(a, "/updates/manifest");
		expect(blocked.status).toBe(429);
		expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
		t += 10 * 60_000;
		expect((await get(a, "/updates/manifest")).status).toBe(204);
	});
});

describe("GET /updates/assets/:name", () => {
	async function assetPath(p: Published, index: number) {
		return new URL(p.assetUrls[index] ?? "").pathname;
	}

	it("serve o arquivo com content-type, cache imutável e conteúdo que bate com o hash do manifesto", async () => {
		const p = await publish();
		const a = app(createFsOtaStore(p.dir));
		const bundle = await get(a, await assetPath(p, 0));
		expect(bundle.status).toBe(200);
		expect(bundle.headers.get("content-type")).toBe("application/javascript");
		expect(bundle.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
		const body = Buffer.from(await bundle.arrayBuffer());
		expect(body.toString()).toBe("console.log('v1')");
		expect(bundle.headers.get("content-length")).toBe(String(body.length));
		const manifest = JSON.parse(p.manifestJson);
		expect(createHash("sha256").update(body).digest("base64url")).toBe(manifest.launchAsset.hash);

		const png = await get(a, await assetPath(p, 1));
		expect(png.headers.get("content-type")).toBe("image/png");
		expect(await png.text()).toBe("png");
	});

	it("arquivo inexistente: 404", async () => {
		const p = await publish();
		const res = await get(app(createFsOtaStore(p.dir)), `/updates/assets/${"A".repeat(43)}.png`);
		expect(res.status).toBe(404);
	});

	it("nomes fora do formato <hash>.<ext>: 400, nunca tocam o disco", async () => {
		const p = await publish();
		const a = app(createFsOtaStore(p.dir));
		for (const name of [
			"manifest.json",
			"..%2F..%2Fetc%2Fpasswd",
			"..%2Fandroid%2Fmanifest.json",
			`${"A".repeat(43)}.PNG`,
			`${"A".repeat(43)}`,
			"%00",
			`${"A".repeat(44)}.png`,
		]) {
			const res = await get(a, `/updates/assets/${name}`);
			expect(res.status, name).toBe(400);
		}
	});

	it("travessia de caminho crua (/../) não chega a servir arquivo", async () => {
		const p = await publish();
		const a = app(createFsOtaStore(p.dir));
		for (const path of [
			"/updates/assets/../android/manifest.json",
			"/updates/assets/../../../../etc/passwd",
		]) {
			const res = await get(a, path);
			expect(res.status, path).toBe(404);
		}
	});

	it("o store também recusa nomes inválidos por conta própria (defesa em profundidade)", async () => {
		const p = await publish();
		const store = createFsOtaStore(p.dir);
		expect(await store.openAsset("../android/manifest.json")).toBeNull();
		expect(await store.openAsset("")).toBeNull();
	});
});

describe("montagem no app", () => {
	it("/updates/manifest é público (sem Authorization) e convive com a API autenticada", async () => {
		const stores = createMemoryStores();
		const now = () => new Date("2026-11-07T12:00:00Z");
		const p = await publish();
		const full = createApp({
			store: stores.auth,
			pairingKey: deriveKey("s".repeat(48), "pairing-code"),
			now,
			stores,
			guard: createPairingGuard(() => now().getTime()),
			vault: createSecretVault({ store: stores.secrets, key: deriveKey("s".repeat(48), "secret-box") }),
			version: "0.0.0-test",
			trustedProxyHops: 0,
			ota: createFsOtaStore(p.dir),
		});
		expect((await full.request("/updates/manifest", { headers: PROTOCOL })).status).toBe(200);
		expect((await full.request("/v1/me")).status).toBe(401);
	});
});
