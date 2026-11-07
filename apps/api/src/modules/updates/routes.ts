import { createHash } from "node:crypto";
import { contentTypeForExt, extOfAssetName, isAssetFileName } from "@orbita/ota";
import { createRateLimiter } from "@orbita/security";
import { Hono } from "hono";
import { clientIp, ipRateLimitKey } from "../../http/client-ip.ts";
import { apiError } from "../../http/errors.ts";
import { rateLimit } from "../../http/rate-limit.ts";
import { type OtaStore, resolveManifest, type StoredUpdate } from "./service.ts";

export type UpdatesRoutesDeps = {
	ota: OtaStore;
	now: () => Date;
	trustedProxyHops: number;
};

/** Cabeçalhos comuns do protocolo (https://docs.expo.dev/technical-specs/expo-updates-1/#common-response-headers). */
const PROTOCOL_HEADERS = {
	"expo-protocol-version": "1",
	"expo-sfv-version": "0",
	// Sempre perguntar de novo: um manifesto em cache esconderia a atualização nova.
	"cache-control": "private, max-age=0",
} as const;

/** Multipart com uma parte `manifest` assinada. Os bytes do manifesto entram sem nenhuma alteração. */
function multipartBody(update: StoredUpdate): { boundary: string; body: Uint8Array<ArrayBuffer> } {
	// A fronteira nasce do hash do conteúdo: determinística e, por construção, ausente do corpo.
	const boundary = `orbita-${createHash("sha256").update(update.manifest).digest("hex").slice(0, 32)}`;
	const head = [
		`--${boundary}`,
		'content-disposition: form-data; name="manifest"',
		"content-type: application/json; charset=utf-8",
		`expo-signature: ${update.signatureHeader}`,
		"",
		"",
	].join("\r\n");
	const parts = [Buffer.from(head), update.manifest, Buffer.from(`\r\n--${boundary}--\r\n`)];
	return { boundary, body: new Uint8Array(Buffer.concat(parts)) };
}

/**
 * Servidor de atualizações OTA do app (Expo Updates v1). Sem login de propósito: o código é aberto e o
 * que protege o app é a assinatura do manifesto, feita fora do servidor, que o app confere contra o
 * certificado embutido. Quem controla o servidor não consegue fazer o app rodar código dele.
 */
export function routes(deps: UpdatesRoutesDeps) {
	const now = () => deps.now().getTime();
	const keyOf = (c: Parameters<typeof clientIp>[0]) => ipRateLimitKey(clientIp(c, deps.trustedProxyHops));
	// O app confere ao abrir e ao voltar do segundo plano. Um download baixa dezenas de arquivos de uma vez.
	const manifestLimiter = createRateLimiter({ limit: 60, windowMs: 10 * 60_000, now });
	const assetLimiter = createRateLimiter({ limit: 600, windowMs: 10 * 60_000, now });

	return new Hono()
		.get("/updates/manifest", rateLimit(manifestLimiter, keyOf), async (c) => {
			const h = (name: string) => c.req.header(name);
			const outcome = await resolveManifest(deps.ota, {
				protocolVersion: h("expo-protocol-version"),
				platform: h("expo-platform"),
				runtimeVersion: h("expo-runtime-version"),
				currentUpdateId: h("expo-current-update-id"),
				accept: h("accept"),
			});

			if (outcome.kind === "error") {
				return c.json(apiError(outcome.code, outcome.message), outcome.status);
			}
			if (outcome.kind === "none") return c.body(null, 204, PROTOCOL_HEADERS);

			const { update } = outcome;
			if (outcome.format === "json") {
				return c.body(new Uint8Array(update.manifest), 200, {
					...PROTOCOL_HEADERS,
					"content-type": "application/expo+json; charset=utf-8",
					"expo-signature": update.signatureHeader,
				});
			}
			const { boundary, body } = multipartBody(update);
			return c.body(body, 200, {
				...PROTOCOL_HEADERS,
				"content-type": `multipart/mixed; boundary=${boundary}`,
			});
		})

		.get("/updates/assets/:name", rateLimit(assetLimiter, keyOf), async (c) => {
			const name = c.req.param("name");
			if (!isAssetFileName(name)) {
				return c.json(apiError("dados_invalidos", "Nome de arquivo inválido."), 400);
			}
			const asset = await deps.ota.openAsset(name);
			if (!asset) return c.json(apiError("nao_encontrado", "Arquivo não encontrado."), 404);
			return c.body(asset.open(), 200, {
				"content-type": contentTypeForExt(extOfAssetName(name)),
				"content-length": String(asset.size),
				// O nome é o hash do conteúdo: o arquivo nunca muda (exigência do protocolo).
				"cache-control": "public, max-age=31536000, immutable",
			});
		});
}
