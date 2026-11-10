import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import {
	isAssetFileName,
	isSignatureHeader,
	OTA_ASSETS_DIR,
	OTA_MANIFEST_FILE,
	OTA_SIGNATURE_FILE,
	type OtaPlatform,
} from "@orbita/ota";
import type { AssetStream, OtaStore, StoredUpdate } from "./service.ts";

function isMissing(e: unknown): boolean {
	const code = (e as NodeJS.ErrnoException | undefined)?.code;
	return code === "ENOENT" || code === "ENOTDIR";
}

/** Entende os campos do manifesto de que o servidor precisa; o resto vai intocado para o app. */
function parseManifest(
	bytes: Uint8Array,
): { id: string; runtimeVersion: string; createdAt: string | null } | null {
	try {
		const json: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
		const { id, runtimeVersion, createdAt } = (json ?? {}) as {
			id?: unknown;
			runtimeVersion?: unknown;
			createdAt?: unknown;
		};
		return typeof id === "string" && id && typeof runtimeVersion === "string" && runtimeVersion
			? { id, runtimeVersion, createdAt: typeof createdAt === "string" ? createdAt : null }
			: null;
	} catch {
		return null;
	}
}

/**
 * Lê o diretório OTA gerado no CI (formato em `@orbita/ota`). Qualquer problema no conteúdo (arquivo
 * pela metade, assinatura em formato estranho) vira "sem atualização" e um log: o servidor nunca
 * repassa lixo ao app, e o app só roda o que a assinatura aprova de qualquer jeito.
 */
export function createFsOtaStore(
	dir: string,
	log: (message: string) => void = (m) => console.error(m),
): OtaStore {
	return {
		async readUpdate(platform: OtaPlatform): Promise<StoredUpdate | null> {
			let manifest: Buffer;
			let signature: string;
			try {
				manifest = await readFile(join(dir, platform, OTA_MANIFEST_FILE));
				signature = (await readFile(join(dir, platform, OTA_SIGNATURE_FILE), "utf8")).trim();
			} catch (e) {
				if (isMissing(e)) return null;
				throw e;
			}
			const meta = parseManifest(manifest);
			if (!meta || !isSignatureHeader(signature)) {
				log(
					`OTA: manifesto ou assinatura inválidos em ${join(dir, platform)}; respondendo "sem atualização".`,
				);
				return null;
			}
			return { ...meta, manifest, signatureHeader: signature };
		},

		async openAsset(name: string): Promise<AssetStream | null> {
			// O nome vem da URL: só entra no caminho se for exatamente `<hash>.<ext>`.
			if (!isAssetFileName(name)) return null;
			const path = join(dir, OTA_ASSETS_DIR, name);
			try {
				const info = await stat(path);
				if (!info.isFile()) return null;
				return {
					size: info.size,
					open: () => Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>,
				};
			} catch (e) {
				if (isMissing(e)) return null;
				throw e;
			}
		},
	};
}

/** Store em memória, para os testes das rotas. */
export function createMemoryOtaStore(
	init: { android?: StoredUpdate; assets?: Record<string, Uint8Array> } = {},
): OtaStore {
	return {
		async readUpdate(platform) {
			return platform === "android" ? (init.android ?? null) : null;
		},
		async openAsset(name) {
			const bytes = init.assets?.[name];
			if (!bytes) return null;
			return {
				size: bytes.byteLength,
				open: () =>
					new ReadableStream<Uint8Array>({
						start(controller) {
							controller.enqueue(bytes);
							controller.close();
						},
					}),
			};
		},
	};
}
