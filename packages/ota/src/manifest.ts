import { createHash } from "node:crypto";
import { assetFileName, contentTypeForExt, OTA_BUNDLE_EXT } from "./layout.ts";

/** Manifesto do protocolo Expo Updates v1 (https://docs.expo.dev/technical-specs/expo-updates-1/). */
export type ManifestAsset = {
	hash: string;
	key: string;
	contentType: string;
	fileExtension?: string;
	url: string;
};

export type UpdateManifest = {
	id: string;
	createdAt: string;
	runtimeVersion: string;
	launchAsset: ManifestAsset;
	assets: ManifestAsset[];
	metadata: Record<string, string>;
	extra: Record<string, unknown>;
};

/** Um arquivo do export: o `key` é o nome que o bundle usa para referenciar o asset (MD5 do Metro). */
export type OtaFile = { key: string; ext: string; bytes: Uint8Array };

export function sha256Base64Url(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("base64url");
}

/** Nome do arquivo de um asset no diretório OTA: depende só do conteúdo, então nunca muda. */
export function otaFileName(file: Pick<OtaFile, "ext" | "bytes">): string {
	return assetFileName(sha256Base64Url(file.bytes), file.ext);
}

/** Origem + caminho do servidor, sem barra no fim. Só https (http apenas em localhost, para testes). */
export function normalizeBaseUrl(raw: string): string {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new Error(`Endereço do servidor inválido: ${raw}`);
	}
	const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
	if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
		throw new Error("O endereço do servidor precisa ser https:// (http só em localhost).");
	}
	if (url.search || url.hash || url.username || url.password) {
		throw new Error("O endereço do servidor não pode ter query, fragmento nem credenciais.");
	}
	return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/** UUID determinístico: o mesmo conteúdo gera o mesmo id, então refazer o build não força download. */
export function manifestId(runtimeVersion: string, fileHashes: string[]): string {
	const digest = createHash("sha256")
		.update(JSON.stringify([runtimeVersion, [...fileHashes].sort()]))
		.digest("hex");
	const variant = ((Number.parseInt(digest.slice(16, 18), 16) & 0x3f) | 0x80).toString(16);
	return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-8${digest.slice(13, 16)}-${variant}${digest.slice(18, 20)}-${digest.slice(20, 32)}`;
}

export type BuildManifestInput = {
	runtimeVersion: string;
	/** ISO 8601. O cliente escolhe a atualização mais recente por este campo. */
	createdAt: string;
	baseUrl: string;
	launch: Pick<OtaFile, "bytes">;
	assets: OtaFile[];
	/** `extra.expoClient` é a configuração pública do app (o `expo-constants` lê daqui depois do OTA). */
	expoClient: Record<string, unknown>;
};

export type BuiltManifest = {
	manifest: UpdateManifest;
	/** Texto exato que será assinado e servido: qualquer byte diferente invalida a assinatura. */
	json: string;
	/** Arquivos a copiar para `<ota>/assets`, já com o nome final. */
	files: { name: string; bytes: Uint8Array }[];
};

export function buildManifest(input: BuildManifestInput): BuiltManifest {
	if (!input.runtimeVersion) throw new Error("runtimeVersion vazio.");
	if (Number.isNaN(Date.parse(input.createdAt))) throw new Error(`createdAt inválido: ${input.createdAt}`);
	const baseUrl = normalizeBaseUrl(input.baseUrl);
	const urlOf = (name: string) => `${baseUrl}/updates/assets/${name}`;

	const files = new Map<string, Uint8Array>();
	const toAsset = (file: OtaFile, key: string): ManifestAsset => {
		const name = otaFileName(file);
		files.set(name, file.bytes);
		return {
			hash: sha256Base64Url(file.bytes),
			key,
			contentType: contentTypeForExt(file.ext),
			url: urlOf(name),
		};
	};

	const launchFile = { key: "bundle", ext: OTA_BUNDLE_EXT, bytes: input.launch.bytes };
	const launchAsset = toAsset(launchFile, "bundle");
	const assets = input.assets.map((a) => ({ ...toAsset(a, a.key), fileExtension: `.${a.ext}` }));

	const manifest: UpdateManifest = {
		id: manifestId(
			input.runtimeVersion,
			[launchAsset, ...assets].map((a) => a.hash),
		),
		createdAt: input.createdAt,
		runtimeVersion: input.runtimeVersion,
		launchAsset,
		assets,
		metadata: {},
		extra: { expoClient: input.expoClient },
	};
	return {
		manifest,
		json: JSON.stringify(manifest),
		files: [...files].map(([name, bytes]) => ({ name, bytes })),
	};
}
