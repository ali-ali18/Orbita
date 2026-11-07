/*
 * Contrato entre quem GERA a atualização (CLI, no GitHub Actions) e quem a SERVE (API).
 * O diretório de saída do CLI, que vira `/app/ota` na imagem, tem este formato:
 *
 *   <ota>/android/manifest.json       manifesto exato que foi assinado (bytes intocados)
 *   <ota>/android/manifest.signature  valor do cabeçalho `expo-signature`
 *   <ota>/assets/<hash>.<ext>         bundle e assets, nomeados pelo SHA-256 (base64url)
 */

export const OTA_PLATFORMS = ["android"] as const;
export type OtaPlatform = (typeof OTA_PLATFORMS)[number];

export function isOtaPlatform(value: string | undefined): value is OtaPlatform {
	return OTA_PLATFORMS.some((p) => p === value);
}

export const OTA_MANIFEST_FILE = "manifest.json";
export const OTA_SIGNATURE_FILE = "manifest.signature";
export const OTA_ASSETS_DIR = "assets";
export const OTA_SIGNATURE_ALG = "rsa-v1_5-sha256";
/** Extensão do bundle JS (o arquivo exportado é bytecode Hermes; o servidor o serve como JavaScript). */
export const OTA_BUNDLE_EXT = "bundle";

/** SHA-256 em base64url sem padding tem sempre 43 caracteres. */
const ASSET_NAME = /^[A-Za-z0-9_-]{43}\.[a-z0-9]{1,8}$/;

/** Só nomes neste formato chegam ao disco: sem `/`, sem `..`, sem nada além de hash e extensão. */
export function isAssetFileName(name: string): boolean {
	return ASSET_NAME.test(name);
}

export function assetFileName(hash: string, ext: string): string {
	const name = `${hash}.${ext}`;
	if (!isAssetFileName(name)) throw new Error(`Nome de asset inválido: ${name}`);
	return name;
}

const CONTENT_TYPES: Record<string, string> = {
	[OTA_BUNDLE_EXT]: "application/javascript",
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	svg: "image/svg+xml",
	xml: "application/xml",
	json: "application/json",
	ttf: "font/ttf",
	otf: "font/otf",
	woff: "font/woff",
	woff2: "font/woff2",
	mp3: "audio/mpeg",
	mp4: "video/mp4",
};

export function contentTypeForExt(ext: string): string {
	return CONTENT_TYPES[ext.toLowerCase()] ?? "application/octet-stream";
}

/** Extensão do nome de arquivo de um asset (`abc.png` → `png`). */
export function extOfAssetName(name: string): string {
	return name.slice(name.lastIndexOf(".") + 1);
}

/** `expo-signature` é um dicionário "Expo SFV": `sig="..."` com a assinatura em base64 padrão. */
export function formatSignatureHeader(input: { signature: string; keyId: string }): string {
	return `sig="${input.signature}", keyid="${input.keyId}", alg="${OTA_SIGNATURE_ALG}"`;
}

const SIGNATURE_HEADER = /^sig="[A-Za-z0-9+/]+={0,2}", keyid="[A-Za-z0-9._-]{1,64}", alg="rsa-v1_5-sha256"$/;

/** Confere o formato antes de repassar o arquivo como cabeçalho HTTP (uma linha só, sem aspas soltas). */
export function isSignatureHeader(value: string): boolean {
	return SIGNATURE_HEADER.test(value);
}
