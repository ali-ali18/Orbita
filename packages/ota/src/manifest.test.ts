import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	assetFileName,
	contentTypeForExt,
	formatSignatureHeader,
	isAssetFileName,
	isSignatureHeader,
} from "./layout.ts";
import { buildManifest, manifestId, normalizeBaseUrl, sha256Base64Url } from "./manifest.ts";

const bytes = (s: string) => new TextEncoder().encode(s);
const input = {
	runtimeVersion: "rt-1",
	createdAt: "2026-11-01T12:00:00.000Z",
	baseUrl: "https://financas.exemplo.dev",
	launch: { bytes: bytes("bundle") },
	assets: [{ key: "0123456789abcdef0123456789abcdef", ext: "png", bytes: bytes("img") }],
	expoClient: { name: "Órbita", version: "0.1.0" },
};

describe("buildManifest", () => {
	it("hash é SHA-256 em base64url do conteúdo e a URL aponta para o arquivo nomeado por ele", () => {
		const { manifest } = buildManifest(input);
		const expected = createHash("sha256").update("bundle").digest("base64url");
		expect(manifest.launchAsset.hash).toBe(expected);
		expect(manifest.launchAsset.hash).toHaveLength(43);
		expect(manifest.launchAsset.url).toBe(`https://financas.exemplo.dev/updates/assets/${expected}.bundle`);
		expect(manifest.launchAsset.contentType).toBe("application/javascript");
		const [asset] = manifest.assets;
		expect(asset).toMatchObject({
			key: "0123456789abcdef0123456789abcdef",
			hash: sha256Base64Url(bytes("img")),
			contentType: "image/png",
			fileExtension: ".png",
		});
	});

	it("o json é o texto do manifesto e os arquivos têm nomes válidos", () => {
		const built = buildManifest(input);
		expect(JSON.parse(built.json)).toEqual(built.manifest);
		expect(built.manifest.runtimeVersion).toBe("rt-1");
		expect(built.manifest.extra).toEqual({ expoClient: input.expoClient });
		expect(built.files).toHaveLength(2);
		for (const f of built.files) expect(isAssetFileName(f.name)).toBe(true);
	});

	it("o id é UUID e depende só do conteúdo e do runtime", () => {
		const a = buildManifest(input).manifest.id;
		expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
		expect(buildManifest({ ...input, createdAt: "2027-01-01T00:00:00Z" }).manifest.id).toBe(a);
		expect(buildManifest({ ...input, launch: { bytes: bytes("outro") } }).manifest.id).not.toBe(a);
		expect(buildManifest({ ...input, runtimeVersion: "rt-2" }).manifest.id).not.toBe(a);
		expect(manifestId("x", ["b", "a"])).toBe(manifestId("x", ["a", "b"]));
	});

	it("asset repetido vira um arquivo só", () => {
		const dup = { key: "k", ext: "png", bytes: bytes("img") };
		expect(buildManifest({ ...input, assets: [dup, { ...dup, key: "k2" }] }).files).toHaveLength(2);
	});

	it("rejeita runtime vazio e data inválida", () => {
		expect(() => buildManifest({ ...input, runtimeVersion: "" })).toThrow();
		expect(() => buildManifest({ ...input, createdAt: "ontem" })).toThrow();
	});
});

describe("normalizeBaseUrl", () => {
	it("tira a barra final e exige https (http só em localhost)", () => {
		expect(normalizeBaseUrl("https://a.dev/")).toBe("https://a.dev");
		expect(normalizeBaseUrl("https://a.dev/orbita//")).toBe("https://a.dev/orbita");
		expect(normalizeBaseUrl("http://localhost:3000")).toBe("http://localhost:3000");
		expect(() => normalizeBaseUrl("http://a.dev")).toThrow(/https/);
		expect(() => normalizeBaseUrl("ftp://a.dev")).toThrow();
		expect(() => normalizeBaseUrl("https://u:p@a.dev")).toThrow();
		expect(() => normalizeBaseUrl("https://a.dev/?x=1")).toThrow();
		expect(() => normalizeBaseUrl("lixo")).toThrow();
	});
});

describe("layout", () => {
	const hash = "A".repeat(43);
	it("só aceita nomes de asset no formato <hash>.<ext>", () => {
		expect(isAssetFileName(`${hash}.png`)).toBe(true);
		for (const bad of [
			`${hash}`,
			`${hash}.`,
			`${hash}.PNG`,
			`../${hash}.png`,
			`${hash}/x.png`,
			`${"A".repeat(42)}.png`,
			`${hash}.png\0`,
			"",
		]) {
			expect(isAssetFileName(bad)).toBe(false);
		}
		expect(() => assetFileName("curto", "png")).toThrow();
	});
	it("content-type por extensão", () => {
		expect(contentTypeForExt("PNG")).toBe("image/png");
		expect(contentTypeForExt("zzz")).toBe("application/octet-stream");
	});
	it("cabeçalho de assinatura: formato aceito e injeção recusada", () => {
		const header = formatSignatureHeader({ signature: "YWJj+/==", keyId: "orbita-ota" });
		expect(header).toBe('sig="YWJj+/==", keyid="orbita-ota", alg="rsa-v1_5-sha256"');
		expect(isSignatureHeader(header)).toBe(true);
		expect(isSignatureHeader(`${header}\r\nx-evil: 1`)).toBe(false);
		expect(isSignatureHeader('sig="a"b", keyid="k", alg="rsa-v1_5-sha256"')).toBe(false);
	});
});
