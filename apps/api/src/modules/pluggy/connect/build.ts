import { createHash } from "node:crypto";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { CONNECT_FILE, CONNECT_MANIFEST, CONNECT_PUBLIC_PREFIX, type ConnectAsset } from "./assets.ts";

const ENTRY = fileURLToPath(new URL("./client/main.ts", import.meta.url));

/**
 * Empacota `client/main.ts` + `pluggy-connect-sdk` (e o zoid dele) num arquivo só. O npm só traz o código em módulos,
 * sem o bundle de navegador (esse mora no CDN do Pluggy). Roda no BUILD (esbuild é devDependency), nunca no servidor.
 */
export async function bundleConnectWidget(): Promise<ConnectAsset> {
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
	return { path: `${CONNECT_PUBLIC_PREFIX}app.${hash}.js`, code };
}

/** Grava `app.<hash>.js` e o `manifest.json` em `dir`, apagando widgets de builds anteriores. */
export async function writeConnectWidget(dir: string, asset: ConnectAsset): Promise<string> {
	const name = asset.path.slice(CONNECT_PUBLIC_PREFIX.length);
	await mkdir(dir, { recursive: true });
	for (const old of await readdir(dir)) if (CONNECT_FILE.test(old) && old !== name) await rm(`${dir}/${old}`);
	await writeFile(`${dir}/${name}`, asset.code);
	await writeFile(`${dir}/${CONNECT_MANIFEST}`, `${JSON.stringify({ file: name })}\n`);
	return name;
}
