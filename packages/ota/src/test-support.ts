import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function tempDir(prefix = "orbita-ota-"): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

/** Chave RSA + certificado autoassinado de TESTE (gerados na hora, nunca commitados), no formato do expo-updates. */
export function makeTestCertificate(opts: { days?: number } = {}): { keyPem: string; certPem: string } {
	const dir = tempDir("orbita-ota-key-");
	const key = join(dir, "key.pem");
	const cert = join(dir, "cert.pem");
	execFileSync(
		"openssl",
		[
			"req",
			"-x509",
			"-newkey",
			"rsa:2048",
			"-nodes",
			"-keyout",
			key,
			"-out",
			cert,
			"-days",
			String(opts.days ?? 365),
			"-subj",
			"/CN=Orbita teste",
			"-addext",
			"keyUsage=digitalSignature",
			"-addext",
			"extendedKeyUsage=codeSigning",
		],
		{ stdio: "ignore" },
	);
	return { keyPem: readFileSync(key, "utf8"), certPem: readFileSync(cert, "utf8") };
}

/** Um `expo export` minúsculo: metadata.json, um bundle e dois assets. */
export function makeFakeExport(dist: string): void {
	mkdirSync(join(dist, "assets"), { recursive: true });
	mkdirSync(join(dist, "_expo/static/js/android"), { recursive: true });
	writeFileSync(join(dist, "_expo/static/js/android/entry-abc.hbc"), "bundle-v1");
	writeFileSync(join(dist, "assets/aaaa1111aaaa1111aaaa1111aaaa1111"), "png-bytes");
	writeFileSync(join(dist, "assets/bbbb2222bbbb2222bbbb2222bbbb2222"), "ttf-bytes");
	writeFileSync(
		join(dist, "metadata.json"),
		JSON.stringify({
			version: 0,
			bundler: "metro",
			fileMetadata: {
				android: {
					bundle: "_expo/static/js/android/entry-abc.hbc",
					assets: [
						{ path: "assets/aaaa1111aaaa1111aaaa1111aaaa1111", ext: "png" },
						{ path: "assets/bbbb2222bbbb2222bbbb2222bbbb2222", ext: "ttf" },
					],
				},
			},
		}),
	);
}

export const KEY_ID = "orbita-ota";

/** Pasta de trabalho no formato que o `prepare` produz. */
export function makeWorkDir(runtimeVersion = "rt-abc"): string {
	const work = tempDir("orbita-ota-work-");
	makeFakeExport(join(work, "dist"));
	writeFileSync(join(work, "runtime-version.txt"), runtimeVersion);
	writeFileSync(join(work, "expo-config.json"), JSON.stringify({ name: "Órbita", version: "0.1.0" }));
	writeFileSync(join(work, "code-signing.json"), JSON.stringify({ keyid: KEY_ID, alg: "rsa-v1_5-sha256" }));
	return work;
}
