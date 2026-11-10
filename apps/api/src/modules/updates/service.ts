import type { OtaPlatform } from "@orbita/ota";
import { isOtaPlatform } from "@orbita/ota";

/** Uma atualização pronta: o manifesto são os bytes exatos que foram assinados no CI. */
export type StoredUpdate = {
	id: string;
	runtimeVersion: string;
	/** `createdAt` do manifesto (ISO 8601), só para o diagnóstico; `null` se o manifesto não trouxer. */
	createdAt: string | null;
	manifest: Uint8Array;
	/** Valor do cabeçalho `expo-signature`. */
	signatureHeader: string;
};

export type AssetStream = { size: number; open: () => ReadableStream<Uint8Array> };

/** De onde vêm as atualizações. Implementações: disco (produção) e memória (testes). */
export interface OtaStore {
	/** `null` = sem atualização para a plataforma (diretório ausente ou vazio). */
	readUpdate(platform: OtaPlatform): Promise<StoredUpdate | null>;
	/** `name` já foi validado por `isAssetFileName`. `null` se o arquivo não existe. */
	openAsset(name: string): Promise<AssetStream | null>;
}

/** O que o servidor está oferecendo agora, para o Diagnóstico do app (`GET /v1/server`). Nada disto é segredo. */
export type OtaOffer = { id: string; runtimeVersion: string; createdAt: string | null };

/** Resumo da atualização publicada, ou `null` sem atualização. Nunca lança: diagnóstico não derruba a rota. */
export async function describeOffer(store: OtaStore, platform: OtaPlatform): Promise<OtaOffer | null> {
	try {
		const update = await store.readUpdate(platform);
		return update
			? { id: update.id, runtimeVersion: update.runtimeVersion, createdAt: update.createdAt }
			: null;
	} catch {
		return null;
	}
}

export type ManifestRequest = {
	protocolVersion: string | undefined;
	platform: string | undefined;
	runtimeVersion: string | undefined;
	/** `expo-current-update-id`: a atualização que o app já está rodando. */
	currentUpdateId: string | undefined;
	accept: string | undefined;
};

export type ManifestOutcome =
	| { kind: "error"; status: 400 | 406; code: string; message: string }
	| { kind: "none" }
	| { kind: "update"; update: StoredUpdate; format: "multipart" | "json" };

const MAX_RUNTIME_VERSION = 256;

/** Formato da resposta a partir do `Accept`. Ausente ou `*\/*` vale multipart, o formato principal do protocolo. */
export function pickFormat(accept: string | undefined): "multipart" | "json" | null {
	if (!accept?.trim()) return "multipart";
	const types = accept.split(",").map((part) => (part.split(";")[0] ?? "").trim().toLowerCase());
	if (types.some((t) => t === "multipart/mixed" || t === "multipart/*" || t === "*/*")) return "multipart";
	if (types.some((t) => t === "application/expo+json" || t === "application/json" || t === "application/*")) {
		return "json";
	}
	return null;
}

/**
 * Decide o que responder a `GET /updates/manifest` (protocolo Expo Updates v1). Só devolve atualização
 * quando o runtimeVersion do app é exatamente o da atualização: um bundle JS só roda no binário
 * nativo para o qual foi compilado.
 */
export async function resolveManifest(store: OtaStore, req: ManifestRequest): Promise<ManifestOutcome> {
	if (req.protocolVersion !== "1") {
		return {
			kind: "error",
			status: 406,
			code: "protocolo_nao_suportado",
			message: "Só o protocolo de atualizações 1 é aceito.",
		};
	}
	const format = pickFormat(req.accept);
	if (!format) {
		return {
			kind: "error",
			status: 406,
			code: "formato_nao_suportado",
			message: "Aceito multipart/mixed ou application/expo+json.",
		};
	}
	if (!req.platform) {
		return {
			kind: "error",
			status: 400,
			code: "dados_invalidos",
			message: "Falta o cabeçalho expo-platform.",
		};
	}
	if (!req.runtimeVersion || req.runtimeVersion.length > MAX_RUNTIME_VERSION) {
		return {
			kind: "error",
			status: 400,
			code: "dados_invalidos",
			message: "Falta o cabeçalho expo-runtime-version (ou ele é grande demais).",
		};
	}
	if (req.platform !== "ios" && !isOtaPlatform(req.platform)) {
		return { kind: "error", status: 400, code: "dados_invalidos", message: "Plataforma desconhecida." };
	}
	// iOS é válido no protocolo, mas este servidor só publica Android.
	if (!isOtaPlatform(req.platform)) return { kind: "none" };

	const update = await store.readUpdate(req.platform);
	if (!update || update.runtimeVersion !== req.runtimeVersion) return { kind: "none" };
	if (req.currentUpdateId && req.currentUpdateId.toLowerCase() === update.id.toLowerCase()) {
		return { kind: "none" };
	}
	return { kind: "update", update, format };
}
