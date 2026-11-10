import type { PluggyConnectionRecord, SecretVault, Stores } from "@orbita/db";
import {
	createPluggyClient,
	diagnoseConnection,
	PluggyError,
	type PluggyFetch,
	removePluggyConnection,
	safeText,
} from "@orbita/ingest";
import { connectionInvestmentCounts } from "@orbita/ledger";
import {
	type DiagLink,
	type PluggyConnectionDto,
	type PluggyConnectSessionResponse,
	type PluggyDiagnosticsResponse,
	type PluggyReimportResponse,
	type PluggyStatusResponse,
	pluggyConnectionCreateBody,
	pluggyConnectionIdParam,
	pluggyConnectionRenameBody,
	pluggyConnectSessionBody,
} from "@orbita/shared";
import { Hono } from "hono";
import { apiError, defined, orNotFound } from "../../http/errors.ts";
import type { ModuleDeps } from "../../http/module-deps.ts";
import type { AppEnv } from "../../http/require-device.ts";
import { validate } from "../../http/validate.ts";
import { connectPagePath, createConnectSession } from "./connect/session.ts";
import { toPluggyConnectionDto } from "./dto.ts";

/** As conexões com as posições de investimento que cada uma trouxe. */
async function listDtos(stores: Stores): Promise<PluggyConnectionDto[]> {
	const [connections, counts] = await Promise.all([
		stores.pluggyConnections.list(),
		connectionInvestmentCounts(stores),
	]);
	return connections.map((c) => toPluggyConnectionDto(c, counts.get(c.id)));
}

async function oneDto(stores: Stores, c: PluggyConnectionRecord): Promise<PluggyConnectionDto> {
	return toPluggyConnectionDto(c, (await connectionInvestmentCounts(stores)).get(c.id));
}

import type { PluggySyncQueue } from "./queue.ts";

export type PluggyRoutesDeps = ModuleDeps & {
	vault: SecretVault;
	/** `null` sem Redis: o app ainda cadastra conexões, mas não dispara sincronização. */
	syncQueue: PluggySyncQueue | null;
	/** Fala com o Pluggy só para conferir o ID de uma conexão nova. Padrão: o `fetch` do Node. */
	fetch?: PluggyFetch;
	now?: () => Date;
};

/** As duas chaves do Pluggy, se estiverem cadastradas e abrirem. Nunca devolvidas por HTTP. */
async function readKeys(vault: SecretVault): Promise<{ clientId: string; clientSecret: string } | null> {
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

/**
 * Meu Pluggy. O plano pessoal não lista conexões pela API: o dono cola o ID (itemId) de cada uma.
 * Nenhuma resposta traz chave, token ou corpo cru do Pluggy; os erros do Pluggy já chegam sanitizados.
 */
export function routes({
	stores,
	vault,
	syncQueue,
	requireDevice,
	fetch: doFetch = (u, i) => fetch(u, i),
	now = () => new Date(),
}: PluggyRoutesDeps) {
	const { pluggyConnections } = stores;
	return new Hono<AppEnv>()
		.use("/v1/pluggy/*", requireDevice)
		.get("/v1/pluggy/connections", async (c) => c.json({ connections: await listDtos(stores) }))
		.post("/v1/pluggy/connections", validate("json", pluggyConnectionCreateBody), async (c) => {
			const { itemId, label } = c.req.valid("json");
			if (await pluggyConnections.get(itemId)) {
				return c.json(apiError("conflito", "Esta conexão do Meu Pluggy já está cadastrada."), 409);
			}
			// Com as chaves já cadastradas, confere no Pluggy que a conexão existe e aproveita o nome do banco.
			let suggested: string | null = null;
			const keys = await readKeys(vault);
			if (keys) {
				try {
					const item = await createPluggyClient({ fetch: doFetch, ...keys, now }).item(itemId);
					suggested = item.connector?.name?.trim().slice(0, 60) || null;
				} catch (e) {
					// ID errado ou de outra conta: avisa na hora. Falha passageira (rede, limite) não impede o cadastro.
					if (e instanceof PluggyError && (e.code === "not_found" || e.code === "forbidden")) {
						return c.json(apiError("conexao_invalida", e.message), 422);
					}
				}
			}
			const connection = await pluggyConnections.add(
				defined({ id: itemId, label: label ?? suggested, byOwner: label != null }),
			);
			return c.json({ connection: await oneDto(stores, connection) }, 201);
		})
		.patch(
			"/v1/pluggy/connections/:id",
			validate("param", pluggyConnectionIdParam),
			validate("json", pluggyConnectionRenameBody),
			async (c) => {
				// O nome é do dono daqui em diante: a sincronização não o troca mais.
				const { id } = c.req.valid("param");
				const { label } = c.req.valid("json");
				const connection = orNotFound(await pluggyConnections.rename(id, label), "Conexão");
				return c.json({ connection: await oneDto(stores, connection) });
			},
		)
		.delete("/v1/pluggy/connections/:id", validate("param", pluggyConnectionIdParam), async (c) => {
			// Remover e MANTER o histórico (não há "remover e apagar" por conexão; o reimport é geral): as contas e os
			// cartões dela são arquivados (saem de saldo, limites, faturas abertas e contagens) e os lançamentos ficam.
			const { id } = c.req.valid("param");
			const connection = orNotFound(await pluggyConnections.get(id), "Conexão");
			// Plano B para contas gravadas antes do vínculo conta → conexão: pergunta ao Pluggy quais contas o item ainda
			// tem e arquiva por id. Sem chaves, sem rede ou com 404, segue só com o vínculo gravado.
			const archived = await removePluggyConnection(stores, id, {
				listExternalIds: async (itemId) => {
					const keys = await readKeys(vault);
					if (!keys) return [];
					const client = createPluggyClient({ fetch: doFetch, ...keys, now, timeoutMs: 15_000 });
					return (await client.accounts(itemId)).map((a) => a.id);
				},
			});
			// Dados anteriores ao vínculo conta → conexão não dizem de quem são: nada foi arquivado aqui, e a próxima
			// sincronização completa os arquiva (as de conexão que não existe mais). Pede essa rodada agora.
			if (archived.accounts + archived.cards === 0 && syncQueue) {
				await syncQueue.enqueue().catch(() => undefined);
			}
			return c.json({ connection: await oneDto(stores, connection) });
		})
		.post("/v1/pluggy/connect-sessions", async (c) => {
			// Corpo opcional: `{ connectionId }` pede a RECONEXÃO de uma conexão já cadastrada.
			const raw: unknown = await c.req.json().catch(() => ({}));
			const parsed = pluggyConnectSessionBody.safeParse(raw ?? {});
			if (!parsed.success) return c.json(apiError("dados_invalidos", "Pedido inválido."), 400);
			const { connectionId } = parsed.data;
			// Só se reconecta o que é do dono: o item tem de estar entre as conexões cadastradas.
			if (connectionId && !(await pluggyConnections.get(connectionId))) {
				return c.json(apiError("nao_encontrado", "Conexão não encontrada."), 404);
			}
			// Quem não tem as chaves não chega à página: avisa já, no app.
			if (!(await readKeys(vault))) {
				return c.json(
					apiError("sem_chaves", "Cadastre as chaves do Pluggy no app (Servidor e chaves)."),
					409,
				);
			}
			const { token, expiresAt } = await createConnectSession(
				stores.pluggyConnectSessions,
				c.get("device").id,
				now(),
				connectionId,
			);
			const body: PluggyConnectSessionResponse = {
				path: connectPagePath(token),
				expiresAt: expiresAt.toISOString(),
			};
			return c.json(body, 201, { "Cache-Control": "no-store" });
		})
		.post("/v1/pluggy/sync", async (c) => {
			if (!syncQueue) {
				return c.json(
					apiError("fila_indisponivel", "A fila de sincronização não está ligada neste servidor."),
					503,
				);
			}
			if ((await pluggyConnections.list()).length === 0) {
				return c.json(apiError("sem_conexoes", "Cadastre o ID de uma conexão do Meu Pluggy primeiro."), 400);
			}
			if (!(await readKeys(vault))) {
				return c.json(
					apiError("sem_chaves", "Cadastre o Client ID e o Client Secret do Pluggy em Servidor e chaves."),
					400,
				);
			}
			return c.json({ sync: await syncQueue.enqueue() }, 202);
		})
		.post("/v1/pluggy/reimport", async (c) => {
			// Tudo que pode falhar sem estrago vem ANTES de apagar: sem fila, conexões ou chaves não há como trazer de volta.
			if (!syncQueue) {
				return c.json(
					apiError("fila_indisponivel", "A fila de sincronização não está ligada neste servidor."),
					503,
				);
			}
			if ((await pluggyConnections.list()).length === 0) {
				return c.json(apiError("sem_conexoes", "Cadastre o ID de uma conexão do Meu Pluggy primeiro."), 400);
			}
			if (!(await readKeys(vault))) {
				return c.json(
					apiError("sem_chaves", "Cadastre o Client ID e o Client Secret do Pluggy em Servidor e chaves."),
					400,
				);
			}
			// Uma sincronização em andamento gravaria a data de agora por cima do zero e a nova só olharia 40 dias.
			if ((await syncQueue.state()) === "running") {
				return c.json(
					apiError("sincronizando", "Há uma sincronização em andamento. Tente de novo quando ela terminar."),
					409,
				);
			}
			// Primeiro esquece a janela, depois apaga: se algo falhar no meio, o pior caso é buscar de novo (idempotente).
			await pluggyConnections.resetSyncWindow();
			const deleted = await stores.transactions.hardDeleteBySource("pluggy");
			const body: PluggyReimportResponse = { deleted, sync: await syncQueue.enqueue() };
			return c.json(body, 202);
		})
		.get("/v1/pluggy/diagnostics", async (c) => {
			// Somente leitura e só do dono (o `requireDevice` do prefixo): chama o Pluggy ao vivo e devolve um resumo
			// REDIGIDO (sem CPF/CNPJ nem número de conta/cartão inteiros). Nada é gravado.
			const keys = await readKeys(vault);
			if (!keys) {
				return c.json(
					apiError("sem_chaves", "Cadastre o Client ID e o Client Secret do Pluggy em Servidor e chaves."),
					409,
				);
			}
			const client = createPluggyClient({ fetch: doFetch, ...keys, now, timeoutMs: 15_000 });
			const linkOf = async (a: { id: string; type: string }): Promise<DiagLink | null> => {
				const card = await stores.cards.findByExternal("pluggy", a.id);
				if (card)
					return {
						kind: "card",
						id: card.id,
						name: safeText(card.name) ?? "?",
						archived: card.archivedAt !== null,
					};
				const account = await stores.accounts.findByExternal("pluggy", a.id);
				if (account) {
					return {
						kind: "account",
						id: account.id,
						name: safeText(account.name) ?? "?",
						archived: account.archivedAt !== null,
					};
				}
				return null;
			};
			const connections = await Promise.all(
				(await pluggyConnections.list()).map((x) => diagnoseConnection({ client, now, linkOf }, x)),
			);
			const body: PluggyDiagnosticsResponse = { generatedAt: now().toISOString(), connections };
			return c.json(body, 200, { "Cache-Control": "no-store" });
		})
		.get("/v1/pluggy/status", async (c) => {
			const connections = await pluggyConnections.list();
			const synced = connections.map((x) => x.lastSyncAt);
			const oldest =
				connections.length > 0 && synced.every((d) => d !== null)
					? new Date(Math.min(...synced.map((d) => (d as Date).getTime())))
					: null;
			const body: PluggyStatusResponse = {
				keysConfigured: (await readKeys(vault)) !== null,
				sync: syncQueue ? await syncQueue.state() : "unavailable",
				lastSyncAt: oldest?.toISOString() ?? null,
				connections: await listDtos(stores),
			};
			return c.json(body);
		});
}
