import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { OTA_ASSETS_DIR, OTA_MANIFEST_FILE, OTA_SIGNATURE_FILE, type OtaPlatform } from "./layout.ts";
import type { BuiltManifest, OtaFile } from "./manifest.ts";

export type ExportedBundle = { launch: { bytes: Uint8Array }; assets: OtaFile[] };

function record(value: unknown, what: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`metadata.json inválido: ${what} não é um objeto.`);
	}
	return value as Record<string, unknown>;
}

/** Caminho dentro do export; o `metadata.json` vem do build, mas nunca saímos da pasta por causa dele. */
function insideDist(dist: string, relative: unknown, what: string): string {
	if (typeof relative !== "string" || relative === "") {
		throw new Error(`metadata.json inválido: ${what} sem caminho.`);
	}
	const root = resolve(dist);
	const full = resolve(root, relative);
	if (!full.startsWith(root + sep)) throw new Error(`metadata.json inválido: ${what} fora do export.`);
	return full;
}

/** Lê o resultado de `expo export --platform <plataforma>` (metadata.json + bundle + assets). */
export async function readExport(dist: string, platform: OtaPlatform): Promise<ExportedBundle> {
	const metadata = record(JSON.parse(await readFile(join(dist, "metadata.json"), "utf8")), "raiz");
	const meta = record(record(metadata.fileMetadata, "fileMetadata")[platform], platform);
	const launch = { bytes: await readFile(insideDist(dist, meta.bundle, "bundle")) };

	if (!Array.isArray(meta.assets)) throw new Error("metadata.json inválido: assets não é uma lista.");
	const assets: OtaFile[] = [];
	for (const raw of meta.assets) {
		const asset = record(raw, "asset");
		const path = insideDist(dist, asset.path, "asset");
		const ext = typeof asset.ext === "string" ? asset.ext.toLowerCase() : "";
		if (!/^[a-z0-9]{1,8}$/.test(ext)) throw new Error(`Extensão de asset inválida: ${String(asset.ext)}`);
		// O Metro nomeia o arquivo pelo MD5 do conteúdo; é a chave que o bundle usa para achar o asset.
		assets.push({ key: basename(path), ext, bytes: await readFile(path) });
	}
	return { launch, assets };
}

export type WriteOtaInput = {
	outDir: string;
	platform: OtaPlatform;
	built: BuiltManifest;
	/** Valor do cabeçalho `expo-signature`. */
	signatureHeader: string;
};

/** Grava o diretório OTA. Só mexe em `<out>/<plataforma>` e `<out>/assets`; o resto de `out` fica. */
export async function writeOtaDir({
	outDir,
	platform,
	built,
	signatureHeader,
}: WriteOtaInput): Promise<void> {
	const platformDir = join(outDir, platform);
	const assetsDir = join(outDir, OTA_ASSETS_DIR);
	await rm(platformDir, { recursive: true, force: true });
	await rm(assetsDir, { recursive: true, force: true });
	await mkdir(assetsDir, { recursive: true });
	await mkdir(dirname(join(platformDir, OTA_MANIFEST_FILE)), { recursive: true });
	for (const file of built.files) await writeFile(join(assetsDir, file.name), file.bytes);
	// O manifesto vai por último: se algo falhar antes, o servidor continua sem atualização.
	await writeFile(join(platformDir, OTA_SIGNATURE_FILE), `${signatureHeader}\n`);
	await writeFile(join(platformDir, OTA_MANIFEST_FILE), built.json);
}
