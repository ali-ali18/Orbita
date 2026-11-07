import { zValidator } from "@hono/zod-validator";
import {
	DataError,
	type PluggyConnectionStore,
	type PluggyConnectSessionStore,
	type SecretVault,
} from "@orbita/db";
import { createPluggyClient, PluggyError, type PluggyFetch } from "@orbita/ingest";
import { createRateLimiter } from "@orbita/security";
import { pluggyConnectCompleteBody, pluggyConnectTokenBody } from "@orbita/shared";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { ZodType } from "zod";
import { clientIp, ipRateLimitKey } from "../../../http/client-ip.ts";
import { apiError } from "../../../http/errors.ts";
import { rateLimit } from "../../../http/rate-limit.ts";
import type { PluggySyncQueue } from "../queue.ts";
import { type ConnectAsset, lazyConnectAsset } from "./assets.ts";
import { connectSecureHeaders, renderConnectPage } from "./page.ts";
import { hashConnectToken } from "./session.ts";

/** Identifica o Órbita no Pluggy; fixo porque o app tem um dono só. */
export const CONNECT_CLIENT_USER_ID = "orbita";
const MAX_BODY_BYTES = 1024;

export type PluggyConnectRoutesDeps = {
	sessions: PluggyConnectSessionStore;
	connections: PluggyConnectionStore;
	vault: SecretVault;
	syncQueue: PluggySyncQueue | null;
	fetch?: PluggyFetch;
	now: () => Date;
	trustedProxyHops: number;
	/** Os testes injetam um bundle pronto para não montar o do widget a cada suíte. */
	asset?: () => Promise<ConnectAsset>;
};

const SESSION_INVALID = apiError(
	"sessao_invalida",
	"Esta sessão expirou ou já foi usada. Volte ao app e toque em Conectar banco de novo.",
);

/** Valida o corpo sempre com a mesma mensagem: rota pública não explica o formato a quem testa. */
const body = <S extends ZodType>(schema: S) =>
	zValidator("json", schema, (result, c) => {
		if (!result.success) return c.json(apiError("dados_invalidos", "Pedido inválido."), 400);
	});

async function readKeys(vault: SecretVault) {
	try {
		const [clientId, clientSecret] = await Promise.all([
			vault.read("pluggy_client_id"),
			vault.read("pluggy_client_secret"),
		]);
		return clientId && clientSecret ? { clientId, clientSecret } : null;
	} catch {
		return null;
	}
}

const NO_KEYS = apiError("sem_chaves", "Cadastre as chaves do Pluggy no app (Servidor e chaves).");

/**
 * Rotas PÚBLICAS (sem Bearer) da página web que abre o Pluggy Connect. Quem autentica é a sessão de uso único criada
 * pelo app (`POST /v1/pluggy/connect-sessions`). Nada aqui devolve chave, apiKey ou corpo cru do Pluggy.
 */
export function routes(deps: PluggyConnectRoutesDeps) {
	const { sessions, connections, vault, syncQueue } = deps;
	const doFetch: PluggyFetch = deps.fetch ?? ((u, i) => fetch(u, i));
	const now = () => deps.now().getTime();
	const keyOf = (c: Parameters<typeof clientIp>[0]) => ipRateLimitKey(clientIp(c, deps.trustedProxyHops));
	const pageLimiter = createRateLimiter({ limit: 60, windowMs: 10 * 60_000, now });
	const actionLimiter = createRateLimiter({ limit: 30, windowMs: 10 * 60_000, now });
	const asset = deps.asset ?? lazyConnectAsset();
	const small = bodyLimit({
		maxSize: MAX_BODY_BYTES,
		onError: (c) => c.json(apiError("corpo_grande", "O pedido é grande demais."), 413),
	});

	return new Hono()
		.use("/pluggy/*", connectSecureHeaders)
		.use("/pluggy/*", async (c, next) => {
			// Nada de resposta guardada: o fragmento e o estado da sessão são de uma visita só.
			await next();
			if (!c.res.headers.has("Cache-Control")) c.res.headers.set("Cache-Control", "no-store");
		})
		.get("/pluggy/conectar", rateLimit(pageLimiter, keyOf), async (c) => {
			try {
				const { path } = await asset();
				return c.html(renderConnectPage(path));
			} catch (e) {
				console.error(e);
				return c.json(apiError("indisponivel", "A página de conexão não está disponível agora."), 503);
			}
		})
		.get("/pluggy/conectar/:file", rateLimit(pageLimiter, keyOf), async (c) => {
			let built: ConnectAsset;
			try {
				built = await asset();
			} catch (e) {
				console.error(e);
				return c.json(apiError("indisponivel", "A página de conexão não está disponível agora."), 503);
			}
			if (built.path !== `/pluggy/conectar/${c.req.param("file")}`) {
				return c.json(apiError("nao_encontrado", "Arquivo não encontrado."), 404);
			}
			return c.body(built.code, 200, {
				"content-type": "text/javascript; charset=utf-8",
				"content-length": String(built.code.byteLength),
				// O nome leva o hash do conteúdo: o arquivo nunca muda.
				"cache-control": "public, max-age=31536000, immutable",
			});
		})
		.post(
			"/pluggy/connect-token",
			rateLimit(actionLimiter, keyOf),
			small,
			body(pluggyConnectTokenBody),
			async (c) => {
				const { session } = c.req.valid("json");
				// Só confere: a sessão é gasta no `connect-complete`, e o widget pode precisar de um token novo antes.
				if (!(await sessions.isActive(hashConnectToken(session), deps.now()))) {
					return c.json(SESSION_INVALID, 401);
				}
				const keys = await readKeys(vault);
				if (!keys) return c.json(NO_KEYS, 409);
				try {
					const client = createPluggyClient({ fetch: doFetch, ...keys, now: deps.now });
					return c.json({ connectToken: await client.connectToken(CONNECT_CLIENT_USER_ID) });
				} catch (e) {
					return c.json(pluggyFailure(e), 502);
				}
			},
		)
		.post(
			"/pluggy/connect-complete",
			rateLimit(actionLimiter, keyOf),
			small,
			body(pluggyConnectCompleteBody),
			async (c) => {
				const { session, itemId } = c.req.valid("json");
				const hash = hashConnectToken(session);
				if (!(await sessions.isActive(hash, deps.now()))) return c.json(SESSION_INVALID, 401);
				const keys = await readKeys(vault);
				if (!keys) return c.json(NO_KEYS, 409);

				// O ID veio do navegador: só vale se o item existe na NOSSA aplicação Pluggy (com as nossas chaves).
				// Isso impede cadastrar um ID de outra conta. Falha passageira não gasta a sessão.
				let name: string | null;
				try {
					const item = await createPluggyClient({ fetch: doFetch, ...keys, now: deps.now }).item(itemId);
					name = item.connector?.name?.trim().slice(0, 60) || null;
				} catch (e) {
					if (e instanceof PluggyError && (e.code === "not_found" || e.code === "forbidden")) {
						return c.json(
							apiError("conexao_invalida", "Não achei essa conexão na sua conta do Pluggy. Tente de novo."),
							422,
						);
					}
					return c.json(pluggyFailure(e), 502);
				}

				// Uso único e atômico: de dois pedidos simultâneos só um passa daqui.
				if (!(await sessions.consume(hash, deps.now()))) return c.json(SESSION_INVALID, 401);

				// Idempotente: se a conexão já existe, é sucesso (o dono refez a conexão do mesmo banco).
				try {
					if (!(await connections.get(itemId))) {
						await connections.add(name ? { id: itemId, label: name } : { id: itemId });
					}
				} catch (e) {
					// Duas conclusões ao mesmo tempo: a outra cadastrou primeiro, o resultado é o mesmo.
					if (!(e instanceof DataError && e.code === "duplicate")) throw e;
				}
				let sync: "queued" | "running" | "unavailable" = "unavailable";
				if (syncQueue) {
					try {
						sync = await syncQueue.enqueue();
					} catch (e) {
						console.error(e);
					}
				}
				return c.json({ connected: true, name, sync });
			},
		);
}

/** Mensagem fixa do `PluggyError` (já sanitizada, pt-BR); qualquer outro erro vira texto genérico. */
function pluggyFailure(e: unknown) {
	if (e instanceof PluggyError) return apiError(`pluggy_${e.code}`, e.message);
	console.error(e);
	return apiError("pluggy_indisponivel", "Não deu para falar com o Pluggy agora. Tente de novo.");
}
