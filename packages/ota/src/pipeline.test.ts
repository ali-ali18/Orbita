import { createHash, createPrivateKey } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isAssetFileName, isSignatureHeader, OTA_MANIFEST_FILE, OTA_SIGNATURE_FILE } from "./layout.ts";
import { signOta } from "./pipeline.ts";
import { readCertificate, signManifest, verifyManifestSignature } from "./sign.ts";
import { KEY_ID, makeTestCertificate, makeWorkDir, tempDir } from "./test-support.ts";

const NOW = new Date("2026-11-07T12:00:00Z");
const { keyPem, certPem } = makeTestCertificate();

function sign(overrides: Partial<Parameters<typeof signOta>[0]> = {}) {
	const out = tempDir();
	const work = makeWorkDir();
	return signOta({
		work,
		out,
		platform: "android",
		baseUrl: "https://financas.exemplo.dev",
		privateKeyPem: keyPem,
		certificatePem: certPem,
		now: NOW,
		...overrides,
	}).then((result) => ({ result, out }));
}

describe("signOta", () => {
	it("grava manifesto, assinatura verificável com a chave pública e assets com hash correto", async () => {
		const { result, out } = await sign();
		const json = readFileSync(join(out, "android", OTA_MANIFEST_FILE), "utf8");
		const header = readFileSync(join(out, "android", OTA_SIGNATURE_FILE), "utf8").trim();
		expect(isSignatureHeader(header)).toBe(true);
		expect(header).toContain(`keyid="${KEY_ID}"`);

		const signature = /sig="([^"]+)"/.exec(header)?.[1] ?? "";
		const { publicKey } = readCertificate(certPem);
		expect(verifyManifestSignature(json, signature, publicKey)).toBe(true);
		// Um byte a mais no manifesto invalida a assinatura.
		expect(verifyManifestSignature(`${json} `, signature, publicKey)).toBe(false);

		const manifest = JSON.parse(json);
		expect(manifest.id).toBe(result.id);
		expect(manifest.runtimeVersion).toBe("rt-abc");
		expect(manifest.assets).toHaveLength(2);
		const files = readdirSync(join(out, "assets"));
		expect(files).toHaveLength(3);
		for (const asset of [manifest.launchAsset, ...manifest.assets]) {
			const name = asset.url.split("/").pop();
			expect(isAssetFileName(name)).toBe(true);
			expect(
				createHash("sha256")
					.update(readFileSync(join(out, "assets", name)))
					.digest("base64url"),
			).toBe(asset.hash);
		}
	});

	it("recusa chave que não é a do certificado embutido no app", async () => {
		const other = makeTestCertificate();
		await expect(sign({ privateKeyPem: other.keyPem })).rejects.toThrow(/não corresponde ao certificado/);
	});

	it("recusa certificado vencido e avisa quando está perto de vencer", async () => {
		await expect(sign({ now: new Date("2040-01-01T00:00:00Z") })).rejects.toThrow(/validade/);
		const soon = makeTestCertificate({ days: 30 });
		const { result } = await sign({ privateKeyPem: soon.keyPem, certificatePem: soon.certPem });
		expect(result.warnings.join()).toMatch(/vence em/);
	});

	it("aceita a chave com \\n literal (segredo colado numa linha só)", async () => {
		const { out } = await sign({ privateKeyPem: keyPem.trim().replace(/\n/g, "\\n") });
		expect(readdirSync(join(out, "android"))).toContain(OTA_MANIFEST_FILE);
	});

	it("não deixa o metadata.json apontar para fora do export", async () => {
		const work = makeWorkDir();
		const metaPath = join(work, "dist/metadata.json");
		const meta = JSON.parse(readFileSync(metaPath, "utf8"));
		meta.fileMetadata.android.assets[0].path = "../../../etc/passwd";
		(await import("node:fs")).writeFileSync(metaPath, JSON.stringify(meta));
		await expect(
			signOta({
				work,
				out: tempDir(),
				platform: "android",
				baseUrl: "https://a.dev",
				privateKeyPem: keyPem,
				certificatePem: certPem,
				now: NOW,
			}),
		).rejects.toThrow(/fora do export/);
	});

	it("sem keyid na config do app, falha com mensagem clara", async () => {
		const work = makeWorkDir();
		(await import("node:fs")).writeFileSync(join(work, "code-signing.json"), "null");
		await expect(
			signOta({
				work,
				out: tempDir(),
				platform: "android",
				baseUrl: "https://a.dev",
				privateKeyPem: keyPem,
				certificatePem: certPem,
				now: NOW,
			}),
		).rejects.toThrow(/keyid/);
	});
});

describe("assinatura", () => {
	it("é RSA PKCS#1 v1.5 SHA-256 em base64 padrão (o formato do expo-updates)", () => {
		const key = createPrivateKey(keyPem);
		const sig = signManifest("{}", key);
		expect(sig).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
		expect(Buffer.from(sig, "base64")).toHaveLength(256);
		// Determinística: PKCS#1 v1.5 não usa aleatoriedade, então a mesma entrada dá a mesma assinatura.
		expect(signManifest("{}", key)).toBe(sig);
	});
});
