import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/** O widget empacotado: o servidor serve o arquivo (nada de CDN), com o hash do conteúdo no nome. */
export interface ConnectAsset {
	/** Caminho público, ex.: `/pluggy/conectar/app.3fa9c1d2.js`. */
	path: string;
	code: Uint8Array<ArrayBuffer>;
}

/** Onde `pnpm --filter @orbita/api build:connect` grava o widget (no Docker, durante o build da imagem). */
export const CONNECT_DIST_DIR = fileURLToPath(new URL("../../../../connect-dist/", import.meta.url));
export const CONNECT_MANIFEST = "manifest.json";
export const CONNECT_FILE = /^app\.[0-9a-f]{8}\.js$/;
export const CONNECT_PUBLIC_PREFIX = "/pluggy/conectar/";

/** Lê o que o build gravou. `null` se a pasta não existe, o manifesto não casa ou o arquivo sumiu. */
export async function readConnectAsset(dir: string): Promise<ConnectAsset | null> {
	const manifest: unknown = JSON.parse(await readFile(`${dir}/${CONNECT_MANIFEST}`, "utf8"));
	const file = (manifest as { file?: unknown } | null)?.file;
	// O nome vem de um arquivo: só vale no formato que o build gera (nada de caminho).
	if (typeof file !== "string" || !CONNECT_FILE.test(file)) return null;
	const buf = await readFile(`${dir}/${file}`);
	return { path: `${CONNECT_PUBLIC_PREFIX}${file}`, code: new Uint8Array(buf) };
}

export const CONNECT_RETRY_AFTER_MS = 10 * 60_000;

/**
 * Lê o widget uma vez e guarda. Se faltar (servidor sem o passo de build), lembra a falha por 10 min em vez de ler o
 * disco e logar a cada pedido. Nunca monta nada em tempo de execução: quem monta é o build.
 */
export function createConnectAssetLoader(options: {
	dir?: string;
	now: () => Date;
	retryAfterMs?: number;
	log?: (e: unknown) => void;
}): () => Promise<ConnectAsset | null> {
	const dir = options.dir ?? CONNECT_DIST_DIR;
	const retryAfterMs = options.retryAfterMs ?? CONNECT_RETRY_AFTER_MS;
	const log = options.log ?? ((e) => console.error("widget do Pluggy Connect indisponível:", e));
	let loaded: ConnectAsset | null = null;
	let failedAt: number | null = null;
	let pending: Promise<ConnectAsset | null> | null = null;
	return async () => {
		if (loaded) return loaded;
		const t = options.now().getTime();
		if (failedAt !== null && t - failedAt < retryAfterMs) return null;
		pending ??= readConnectAsset(dir)
			.then((asset) => {
				if (!asset) throw new Error("manifesto inválido");
				loaded = asset;
				failedAt = null;
				return asset;
			})
			.catch((e: unknown) => {
				failedAt = t;
				log(e);
				return null;
			})
			.finally(() => {
				pending = null;
			});
		return pending;
	};
}
