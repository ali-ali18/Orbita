import { z } from "zod";
import { timestampSchema } from "./finance-primitives.ts";

/*
 * Meu Pluggy. O plano pessoal não lista conexões pela API: o dono cola o ID de cada conexão (itemId) uma vez.
 * Nenhuma resposta daqui carrega chave, token ou segredo; só o estado.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O itemId do Pluggy é um UUID. Minúsculo no banco, para não haver duas conexões "iguais". */
export const pluggyItemIdSchema = z
	.string("Informe o ID da conexão.")
	.trim()
	.regex(UUID, "O ID da conexão é um código no formato 00000000-0000-0000-0000-000000000000.")
	.transform((v) => v.toLowerCase());

export const PLUGGY_LABEL_MAX = 60;

/**
 * Dias que a primeira sincronização de uma conexão busca para trás (6 meses). O servidor usa este número na janela e
 * o app o usa no texto da tela "Pronto": um valor só, para o texto nunca divergir do que foi importado.
 */
export const PLUGGY_FIRST_SYNC_DAYS = 183;

/** Resultado da última sincronização de uma conexão. */
export const PLUGGY_SYNC_STATUSES = ["ok", "partial", "error", "no_keys"] as const;
export type PluggySyncStatus = (typeof PLUGGY_SYNC_STATUSES)[number];

/**
 * `lastError` de uma conexão cujo banco pediu login de novo (`LOGIN_ERROR`, `WAITING_USER_INPUT`, `WAITING_USER_ACTION`).
 * O servidor grava; o app reconhece pelo começo da frase (conexões antigas têm o final diferente).
 */
export const PLUGGY_RECONNECT_PREFIX = "O banco pediu para você reconectar.";
export const PLUGGY_RECONNECT_MESSAGE = `${PLUGGY_RECONNECT_PREFIX} Toque em Reconectar no app e sincronize de novo.`;

/**
 * `lastError` do PRIMEIRO 404 de uma conexão que já sincronizou: ainda não é remoção (chave trocada ou falha do
 * Pluggy dão o mesmo 404), então nada é arquivado. O segundo 404 seguido, com outro item respondendo, é a remoção.
 */
export const PLUGGY_MISSING_PREFIX = "Não encontrei esta conexão no Meu Pluggy.";
export const PLUGGY_MISSING_MESSAGE = `${PLUGGY_MISSING_PREFIX} Confiro de novo na próxima sincronização.`;

/**
 * `lastError` de uma conexão cujo item sumiu do Meu Pluggy (404): o dono a removeu lá. O Órbita arquiva as contas e
 * cartões dela (saem do saldo e das contagens) e mantém os lançamentos no histórico.
 */
export const PLUGGY_REMOVED_PREFIX = "Conexão removida no Meu Pluggy.";
export const PLUGGY_REMOVED_MESSAGE = `${PLUGGY_REMOVED_PREFIX} As contas dela saíram do saldo e os lançamentos continuam no histórico. Conecte o banco de novo ou remova esta conexão.`;

/** A conexão precisa de login novo no banco (não é falha do Pluggy nem das chaves). */
export function needsReconnect(c: {
	lastStatus: PluggySyncStatus | null;
	lastError: string | null;
}): boolean {
	return c.lastStatus === "error" && (c.lastError?.startsWith(PLUGGY_RECONNECT_PREFIX) ?? false);
}

/**
 * Começo do `lastError` de uma conexão que ainda espera o banco (`lastStatus` "partial"; o app reconhece pelo começo
 * da frase, como em `PLUGGY_RECONNECT_PREFIX`). "Atualizando": o item do Pluggy está `UPDATING`. "Sem contas": o item
 * respondeu, mas `GET /accounts` não trouxe conta nem cartão.
 */
export const PLUGGY_UPDATING_PREFIX = "O banco ainda está atualizando os dados no Pluggy.";
export const PLUGGY_NO_ACCOUNTS_PREFIX = "Conectado, mas o banco ainda não enviou contas.";
/** Só veio produto que o Órbita não lê (investimento): informação, não falha (`lastStatus` "ok"). */
export const PLUGGY_UNREAD_PRODUCTS_PREFIX = "O banco só enviou produtos que o Órbita ainda não lê.";
/**
 * `GET /accounts` veio vazio, mas `GET /investments` trouxe posições, e a conexão ainda é nova (o espelho do MeuPluggy
 * pode estar sendo preenchido): `lastStatus` "ok" e o servidor tenta de novo. Em conexão antiga a frase segue com "Conta e
 * cartão aparecem aqui se o banco enviar." Os investimentos são lidos e gravados: não é "produto que o Órbita não lê".
 */
export const PLUGGY_ONLY_INVESTMENTS_PREFIX = "O banco enviou só investimentos por enquanto.";
/** Veio conta, mas nenhum lançamento nem fatura, e o item foi atualizado antes da autorização (espelho ainda vazio). */
export const PLUGGY_NO_DATA_PREFIX = "Conectado, mas o banco ainda não enviou lançamentos.";

/** O que a conexão espera do banco, pelo que a última sincronização gravou; `null` se não espera nada. */
export function pluggyWaitingFor(c: {
	lastStatus: PluggySyncStatus | null;
	lastError: string | null;
}): "updating" | "no_accounts" | "no_data" | "unread_products" | null {
	if (
		c.lastStatus === "ok" &&
		(c.lastError?.startsWith(PLUGGY_UNREAD_PRODUCTS_PREFIX) ||
			c.lastError?.startsWith(PLUGGY_ONLY_INVESTMENTS_PREFIX))
	)
		return "unread_products";
	if (c.lastStatus !== "partial") return null;
	if (c.lastError?.startsWith(PLUGGY_UPDATING_PREFIX)) return "updating";
	if (c.lastError?.startsWith(PLUGGY_NO_ACCOUNTS_PREFIX)) return "no_accounts";
	if (c.lastError?.startsWith(PLUGGY_NO_DATA_PREFIX)) return "no_data";
	return null;
}

/** Sem caractere de controle (quebra de linha, tabulação, etc.): o nome vai para uma linha só. */
const noControlChars = (v: string) => !/[\p{Cc}\p{Cf}]/u.test(v);

/** Nome de uma conexão: 1..60 letras, aparado, sem controle. */
export const pluggyLabelSchema = z
	.string("Informe um nome.")
	.trim()
	.min(1, "Informe um nome.")
	.max(PLUGGY_LABEL_MAX, "O nome passa de 60 letras.")
	.refine(noControlChars, "O nome tem caracteres que não podem ser usados.");

/** `PATCH /v1/pluggy/connections/:id`: o dono renomeia; a sincronização não troca mais o nome. */
export const pluggyConnectionRenameBody = z.object({ label: pluggyLabelSchema }).strict();
export type PluggyConnectionRenameBody = z.infer<typeof pluggyConnectionRenameBody>;

export const pluggyConnectionCreateBody = z
	.object({
		itemId: pluggyItemIdSchema,
		label: z
			.string()
			.trim()
			.min(1, "Informe um nome.")
			.max(PLUGGY_LABEL_MAX, "O nome passa de 60 letras.")
			.nullish(),
	})
	.strict();
export type PluggyConnectionCreateBody = z.infer<typeof pluggyConnectionCreateBody>;

export const pluggyConnectionIdParam = z.object({ id: pluggyItemIdSchema });

export const pluggyConnectionDto = z.object({
	id: z.string(),
	label: z.string().nullable(),
	createdAt: timestampSchema,
	lastSyncAt: timestampSchema.nullable(),
	lastStatus: z.enum(PLUGGY_SYNC_STATUSES).nullable(),
	lastError: z.string().nullable(),
	/**
	 * O que a última sincronização trouxe desta conexão: contas e cartões do Órbita ligados a ela e as posições de
	 * investimento (`active`: entram no patrimônio; `noBalance`: ativas com saldo zero; `closed`: encerradas;
	 * `foreignCurrency`: em outra moeda). Ausente (servidor antigo) = não se sabe.
	 */
	summary: z.object({
		accounts: z.number().int().min(0),
		cards: z.number().int().min(0),
		investments: z
			.object({
				active: z.number().int().min(0),
				noBalance: z.number().int().min(0),
				closed: z.number().int().min(0),
				foreignCurrency: z.number().int().min(0),
			})
			.optional(),
	}),
});
export type PluggyConnectionDto = z.infer<typeof pluggyConnectionDto>;

export const pluggyConnectionsResponse = z.object({ connections: z.array(pluggyConnectionDto) });
export const pluggyConnectionResponse = z.object({ connection: pluggyConnectionDto });

/** `GET /v1/pluggy/status`. */
export const pluggyStatusResponse = z.object({
	/** Client ID e Client Secret cadastrados (e legíveis com o `APP_SECRET` atual). */
	keysConfigured: z.boolean(),
	/** "idle" nada a fazer; "queued" esperando o worker; "running" sincronizando agora; "unavailable" sem fila (Redis). */
	sync: z.enum(["idle", "queued", "running", "unavailable"]),
	/** Início da sincronização mais antiga entre as conexões (o dado mais velho que o app tem); `null` se nenhuma terminou. */
	lastSyncAt: timestampSchema.nullable(),
	connections: z.array(pluggyConnectionDto),
});
export type PluggyStatusResponse = z.infer<typeof pluggyStatusResponse>;

/** `POST /v1/pluggy/sync` (202). */
export const pluggySyncResponse = z.object({ sync: z.enum(["queued", "running"]) });
export type PluggySyncResponse = z.infer<typeof pluggySyncResponse>;

/** `POST /v1/pluggy/reimport` (202): quantos lançamentos do Pluggy saíram e como está a nova sincronização. */
export const pluggyReimportResponse = z.object({
	deleted: z.number().int().min(0),
	sync: z.enum(["queued", "running"]),
});
export type PluggyReimportResponse = z.infer<typeof pluggyReimportResponse>;

/** `POST /v1/pluggy/connect-sessions` (201). O caminho (com o token no fragmento) é relativo ao endereço do servidor. */
export const pluggyConnectSessionResponse = z.object({
	path: z.string(),
	expiresAt: timestampSchema,
});
export type PluggyConnectSessionResponse = z.infer<typeof pluggyConnectSessionResponse>;

/**
 * Corpo de `POST /v1/pluggy/connect-sessions`. Sem `connectionId` é uma conexão nova; com ele é a reconexão de uma
 * conexão já cadastrada (o Pluggy Connect abre em modo de atualização do mesmo item, sem criar item novo).
 */
export const pluggyConnectSessionBody = z.object({ connectionId: pluggyItemIdSchema.optional() }).strict();
export type PluggyConnectSessionBody = z.infer<typeof pluggyConnectSessionBody>;

/** Token da sessão de conexão: 32 bytes aleatórios em base64url. */
export const PLUGGY_CONNECT_TOKEN_LENGTH = 43;
export const pluggyConnectTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

/** Corpos das rotas públicas da página web do Pluggy Connect (autenticadas pela sessão, sem Bearer). */
export const pluggyConnectTokenBody = z.object({ session: pluggyConnectTokenSchema }).strict();
export const pluggyConnectCompleteBody = z
	.object({ session: pluggyConnectTokenSchema, itemId: pluggyItemIdSchema })
	.strict();
