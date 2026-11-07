import { createHash, randomUUID } from "node:crypto";
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

/** Origem + caminho do servidor, sem barra no fim. Só https (o mesmo critério do app.config.ts do app). */
export function normalizeBaseUrl(raw: string): string {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new Error(`Endereço do servidor inválido: ${raw}`);
	}
	if (url.protocol !== "https:") throw new Error("O endereço do servidor precisa ser https://.");
	if (url.search || url.hash || url.username || url.password) {
		throw new Error("O endereço do servidor não pode ter query, fragmento nem credenciais.");
	}
	return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

export type BuildManifestInput = {
	runtimeVersion: string;
	/**
	 * UUID desta PUBLICAÇÃO. Cada publicação tem o seu, mesmo com conteúdo igual: se o id dependesse só do
	 * conteúdo, voltar a um bundle antigo repetiria um id que o celular já tem (com `createdAt` antigo) e ele
	 * ficaria na versão defeituosa. Padrão: UUID aleatório.
	 */
	id?: string;
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

	// A `key` do asset identifica o arquivo no celular: o expo-updates reaproveita o arquivo já baixado que tiver a
	// mesma key. Com a key do bundle fixa, o celular rodaria o JS da primeira atualização para sempre. Por isso
	// a key do bundle é o hash do conteúdo.
	const launchFile = {
		key: sha256Base64Url(input.launch.bytes),
		ext: OTA_BUNDLE_EXT,
		bytes: input.launch.bytes,
	};
	const launchAsset = toAsset(launchFile, launchFile.key);
	const assets = input.assets.map((a) => ({ ...toAsset(a, a.key), fileExtension: `.${a.ext}` }));

	const manifest: UpdateManifest = {
		id: input.id ?? randomUUID(),
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
