import { z } from "zod";
import { idSchema } from "./finance-primitives.ts";

/*
 * Chat com a Órbita. O app manda a mensagem, o servidor responde em SSE (texto aos poucos + cards) e guarda
 * o histórico. Números e textos dos cards vêm prontos do engine: o app só desenha.
 */

export const CHAT_MESSAGE_MAX = 2000;

/** Códigos de erro que o app trata de forma especial (o resto vira só a mensagem). */
export const CHAT_ERROR_CODES = {
	/** Sem chave da Anthropic cadastrada: o app leva a Configurações → Servidor e chaves. */
	noKey: "sem_chave_anthropic",
	/** A chave existe, mas o servidor não consegue abri-la (APP_SECRET trocado). */
	unreadableKey: "chave_ilegivel",
	/** O limite de gasto do mês com a IA foi atingido. */
	monthlyLimit: "limite_mensal_ia",
} as const;

export const chatRequestBody = z
	.object({
		/** Ausente = conversa nova. */
		conversationId: idSchema.optional(),
		message: z
			.string({ error: "Escreva a mensagem." })
			.trim()
			.min(1, "Escreva a mensagem.")
			.max(CHAT_MESSAGE_MAX, `A mensagem tem até ${CHAT_MESSAGE_MAX} letras.`),
	})
	.strict();
export type ChatRequestBody = z.infer<typeof chatRequestBody>;

// ---------------------------------------------------------------- cards

/** Card genérico de resultado de ferramenta: título e linhas (rótulo, legenda e valor já formatados). */
export const chatRowsCardSchema = z.object({
	type: z.literal("rows"),
	/** Ferramenta que gerou o card (ex.: `get_month_summary`). */
	tool: z.string(),
	title: z.string(),
	rows: z.array(
		z.object({
			label: z.string(),
			caption: z.string().nullable(),
			/** Já formatado ("R$ 46,90", "12%"). */
			value: z.string(),
			/** Centavos, quando a linha é dinheiro (o app usa para a barra); `null` caso contrário. */
			cents: z.number().int().nullable(),
		}),
	),
	/** Linha de total, se houver. */
	total: z.object({ label: z.string(), value: z.string() }).nullable(),
});
export type ChatRowsCard = z.infer<typeof chatRowsCardSchema>;

export const PROPOSAL_KINDS = [
	"create_transaction",
	"categorize_transaction",
	"confirm_transaction",
] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

export const PROPOSAL_STATUSES = ["pending", "confirmed", "canceled", "undone"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/** Uma escrita proposta pela IA. Só vira realidade quando o dono confirma. */
export const proposalSchema = z.object({
	id: idSchema,
	kind: z.enum(PROPOSAL_KINDS),
	status: z.enum(PROPOSAL_STATUSES),
	title: z.string(),
	lines: z.array(z.object({ label: z.string(), value: z.string() })),
	/** Lançamento criado ou alterado (depois de confirmar); `null` antes. */
	transactionId: z.string().nullable(),
});
export type ProposalDto = z.infer<typeof proposalSchema>;

export const chatProposalCardSchema = z.object({ type: z.literal("proposal"), proposal: proposalSchema });
export type ChatProposalCard = z.infer<typeof chatProposalCardSchema>;

export const chatCardSchema = z.discriminatedUnion("type", [chatRowsCardSchema, chatProposalCardSchema]);
export type ChatCard = z.infer<typeof chatCardSchema>;

// ------------------------------------------------------------ SSE

/** Eventos de `POST /v1/chat` (cada um é um `data:` JSON no fluxo SSE). */
export const chatEventSchema = z.discriminatedUnion("type", [
	/** `model`: o modelo que vai responder este turno (o app mostra no cabeçalho). */
	z.object({ type: z.literal("meta"), conversationId: z.string(), model: z.string().optional() }),
	z.object({ type: z.literal("text"), delta: z.string() }),
	/** A IA começou a consultar algo (o app mostra "Consultando…"). */
	z.object({ type: z.literal("tool"), name: z.string(), label: z.string() }),
	z.object({ type: z.literal("card"), card: chatCardSchema }),
	z.object({ type: z.literal("done"), messageId: z.string() }),
	z.object({ type: z.literal("error"), code: z.string(), message: z.string() }),
]);
export type ChatEvent = z.infer<typeof chatEventSchema>;

// ----------------------------------------------------- conversas

export const chatMessageDtoSchema = z.object({
	id: z.string(),
	role: z.enum(["user", "assistant"]),
	text: z.string(),
	cards: z.array(chatCardSchema),
	createdAt: z.string(),
});
export type ChatMessageDto = z.infer<typeof chatMessageDtoSchema>;

export const chatConversationDtoSchema = z.object({
	id: z.string(),
	title: z.string(),
	updatedAt: z.string(),
});
export type ChatConversationDto = z.infer<typeof chatConversationDtoSchema>;

// ---------------------------------------------------- custo da IA

/** Teto do limite que o dono pode digitar: US$ 10.000,00 (em centavos de dólar). */
export const AI_LIMIT_MAX_USD_CENTS = 1_000_000;

/**
 * `PUT /v1/settings/ai`: `monthlyLimitUsdCents` `null` tira o limite; `chatModel`/`chatModelFast` `null` voltam ao
 * padrão do servidor (o id fora da lista permitida é recusado pela API). `chatModelFast` aceita "off" (desligado).
 * Campo ausente fica como está; envie pelo menos um.
 */
export const aiSettingsPutBody = z
	.object({
		monthlyLimitUsdCents: z
			.number({ error: "Informe o limite em dólares." })
			.int("O limite deve ser em centavos de dólar, inteiro.")
			.min(0, "O limite não pode ser negativo.")
			.max(AI_LIMIT_MAX_USD_CENTS, "O limite passa do máximo aceito (US$ 10.000).")
			.nullable()
			.optional(),
		chatModel: z.string({ error: "Modelo inválido." }).min(1).max(80).nullable().optional(),
		chatModelFast: z.string({ error: "Modelo inválido." }).min(1).max(80).nullable().optional(),
	})
	.strict()
	.refine((v) => Object.values(v).some((x) => x !== undefined), "Envie o que mudar.");
export type AiSettingsPutBody = z.infer<typeof aiSettingsPutBody>;

/** `GET` e `PUT /v1/settings/ai`: o gasto do mês com a IA (em dólar, que é como a Anthropic cobra) e o limite. */
export const aiSettingsResponse = z.object({
	month: z.string(),
	/** Custo do mês em micro-dólares (1 US$ = 1.000.000), inteiro. */
	costMicroUsd: z.number().int(),
	requests: z.number().int(),
	inputTokens: z.number().int(),
	outputTokens: z.number().int(),
	/** `null` = sem limite. */
	limitUsdCents: z.number().int().nullable(),
	/** O gasto já atingiu o limite: o chat responde só com o aviso. */
	blocked: z.boolean(),
	/** A chave da Anthropic está cadastrada. */
	keyConfigured: z.boolean(),
	/** Modelos em uso agora (o salvo no app, ou o padrão do servidor). `chatModelFast` `null` = desligado. */
	chatModel: z.string(),
	chatModelFast: z.string().nullable(),
	/** O dono escolheu no app (`true`) ou vale o padrão do servidor (`false`). */
	chatModelCustom: z.boolean(),
	chatModelFastCustom: z.boolean(),
	/** Modelos que dá para escolher, com o preço por milhão de tokens (micro-dólares). */
	modelOptions: z.array(
		z.object({
			id: z.string(),
			label: z.string(),
			description: z.string(),
			main: z.boolean(),
			fast: z.boolean(),
			inputMicroUsdPerMTok: z.number().int(),
			outputMicroUsdPerMTok: z.number().int(),
			/** Preço ainda não conferido: o app cobra pelo maior valor conhecido. */
			priceToConfirm: z.boolean(),
		}),
	),
});
export type AiSettingsResponse = z.infer<typeof aiSettingsResponse>;

/** Custo em micro-dólares → centavos de dólar, arredondado para cima (nunca mostra menos do que se gastou). */
export const microUsdToUsdCents = (micro: number): number => Math.ceil(micro / 10_000);

/** "US$ 1,23". Inteiros: centavos de dólar. */
export function formatUsdCents(cents: number): string {
	const abs = Math.abs(cents);
	const dollars = Math.floor(abs / 100)
		.toString()
		.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
	return `${cents < 0 ? "−" : ""}US$ ${dollars},${(abs % 100).toString().padStart(2, "0")}`;
}
