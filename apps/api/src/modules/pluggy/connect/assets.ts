import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

/** O widget empacotado: o servidor serve o arquivo (nada de CDN), com o hash do conteúdo no nome. */
export interface ConnectAsset {
	/** Caminho público, ex.: `/pluggy/conectar/app.3fa9c1d2.js`. */
	path: string;
	code: Uint8Array<ArrayBuffer>;
}

const ENTRY = fileURLToPath(new URL("./client/main.ts", import.meta.url));

/**
 * Empacota `client/main.ts` + `pluggy-connect-sdk` (e o zoid dele) num arquivo só. O npm só traz o código em módulos,
 * sem o bundle de navegador (esse mora no CDN do Pluggy), então o servidor monta o seu na primeira vez que a página é
 * pedida e guarda na memória. Falha de montagem derruba só a página (a rota responde 503), nunca o servidor.
 */
export async function buildConnectAsset(): Promise<ConnectAsset> {
	const result = await build({
		entryPoints: [ENTRY],
		bundle: true,
		write: false,
		format: "iife",
		platform: "browser",
		target: ["es2020"],
		minify: true,
		legalComments: "none",
		logLevel: "silent",
		// Nada do ambiente do servidor entra no código do navegador.
		define: { "process.env.NODE_ENV": '"production"' },
	});
	const file = result.outputFiles[0];
	if (!file) throw new Error("esbuild não gerou saída");
	const code = new Uint8Array(file.contents);
	const hash = createHash("sha256").update(code).digest("hex").slice(0, 8);
	return { path: `/pluggy/conectar/app.${hash}.js`, code };
}

/** Monta uma vez só; se falhar, tenta de novo no próximo pedido. */
export function lazyConnectAsset(builder: () => Promise<ConnectAsset> = buildConnectAsset) {
	let pending: Promise<ConnectAsset> | null = null;
	return () => {
		pending ??= builder().catch((e: unknown) => {
			pending = null;
			throw e;
		});
		return pending;
	};
}
