import { z } from "zod";
import { idSchema, MAX_CENTS, timestampSchema } from "./finance-primitives.ts";

/*
 * Agentes e avisos. Os avisos são decididos por funções puras do engine (`@orbita/core`) e gravados pelo worker;
 * a IA só escreve o texto em cima de números prontos. O app mostra, liga e desliga, e abre a conversa.
 */

// ------------------------------------------------------------------ catálogo

export const BUILTIN_AGENT_KEYS = [
	"orbita",
	"vigia",
	"fechamento",
	"metas",
	"caca_assinatura",
	"cofrinho",
] as const;
export type BuiltinAgentKey = (typeof BUILTIN_AGENT_KEYS)[number];

export const AGENT_FREQUENCIES = ["daily", "weekly", "monthly"] as const;
export type AgentFrequency = (typeof AGENT_FREQUENCIES)[number];

export const ALERT_STATUSES = ["new", "seen", "dismissed"] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

export const ALERT_KINDS = [
	"unusual_spending",
	"duplicate_charge",
	"budget_threshold",
	"new_subscription",
	"price_increase",
	"month_closing",
	"goal_behind",
	"saving_suggestion",
	"custom",
] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

export const AGENT_NAME_MAX = 40;
export const AGENT_INSTRUCTIONS_MAX = 1000;
export const ALERT_TITLE_MAX = 120;
export const ALERT_BODY_MAX = 600;
/** Quantas ferramentas de leitura um agente do dono pode ter (são poucas, e todas só leem). */
export const AGENT_TOOLS_MAX = 12;

/**
 * As ferramentas de LEITURA que um agente do dono pode usar (o servidor confere que esta lista é igual à de
 * `@orbita/agents`). Nenhuma escreve nem move dinheiro.
 */
export const AGENT_TOOL_OPTIONS = [
	{ name: "get_month_summary", label: "Resumo do mês" },
	{ name: "get_month_report", label: "Relatório do mês" },
	{ name: "get_budget_status", label: "Orçamento" },
	{ name: "get_category_breakdown", label: "Gasto por categoria" },
	{ name: "search_transactions", label: "Lançamentos" },
	{ name: "get_card_invoice", label: "Fatura do cartão" },
	{ name: "list_subscriptions", label: "Assinaturas" },
	{ name: "goals_status", label: "Metas" },
	{ name: "income_plan", label: "Plano da renda" },
	{ name: "analyze_history", label: "Análise do histórico" },
	{ name: "list_catalog", label: "Contas, cartões e categorias" },
] as const;
export const AGENT_TOOL_NAMES: readonly string[] = AGENT_TOOL_OPTIONS.map((t) => t.name);

// ------------------------------------------------------------------- agenda

export const agentScheduleSchema = z
	.object({
		frequency: z.enum(AGENT_FREQUENCIES, { error: "Frequência inválida." }),
		/** Hora cheia no fuso do dono (0 a 23). */
		hour: z
			.number()
			.int("A hora deve ser inteira.")
			.min(0, "A hora vai de 0 a 23.")
			.max(23, "A hora vai de 0 a 23."),
		/** Semanal: dia da semana (0 = domingo a 6). Mensal: dia do mês (1 a 28). Diário: `null`. */
		day: z.number().int("O dia deve ser inteiro.").nullable(),
	})
	.strict()
	.superRefine((value, ctx) => {
		const fail = (message: string) => ctx.addIssue({ code: "custom", path: ["day"], message });
		if (value.frequency === "daily" && value.day !== null) fail("Agenda diária não tem dia.");
		if (value.frequency === "weekly" && (value.day === null || value.day < 0 || value.day > 6)) {
			fail("O dia da semana vai de 0 (domingo) a 6.");
		}
		if (value.frequency === "monthly" && (value.day === null || value.day < 1 || value.day > 28)) {
			fail("O dia do mês vai de 1 a 28.");
		}
	});
export type AgentSchedule = z.infer<typeof agentScheduleSchema>;

// --------------------------------------------------------------- configurações

const centsSetting = z.number().int().min(100, "O mínimo é R$ 1,00.").max(MAX_CENTS);

/** Cada agente da casa tem as suas escolhas; todas validadas aqui, na borda, e `strict` (campo desconhecido é erro). */
export const agentSettingsSchemas = {
	orbita: z.object({}).strict(),
	vigia: z
		.object({
			/** Gasto que foge do usual da categoria (mediana). */
			unusualSpending: z.boolean(),
			/** Só gasto a partir deste valor entra na comparação ("Gasto grande de uma vez"). */
			unusualMinCents: centsSetting,
			/** Mesmo estabelecimento e valor em poucos dias. */
			duplicateCharge: z.boolean(),
			duplicateWindowDays: z.number().int().min(1, "De 1 a 14 dias.").max(14, "De 1 a 14 dias."),
			/** Categoria passou do percentual de aviso do orçamento (o mesmo das Preferências). */
			budgetThreshold: z.boolean(),
		})
		.strict(),
	fechamento: z
		.object({
			monthlySummary: z.boolean(),
			compareWithPrevious: z.boolean(),
			suggestLeftover: z.boolean(),
		})
		.strict(),
	metas: z.object({ warnBehind: z.boolean() }).strict(),
	caca_assinatura: z.object({ findRecurring: z.boolean(), priceIncrease: z.boolean() }).strict(),
	cofrinho: z.object({ suggestSaving: z.boolean(), minCents: centsSetting }).strict(),
} as const satisfies Record<BuiltinAgentKey, z.ZodType>;

export type AgentSettingsOf<K extends BuiltinAgentKey> = z.infer<(typeof agentSettingsSchemas)[K]>;
export type VigiaSettings = AgentSettingsOf<"vigia">;
export type FechamentoSettings = AgentSettingsOf<"fechamento">;
export type MetasSettings = AgentSettingsOf<"metas">;
export type CacaSettings = AgentSettingsOf<"caca_assinatura">;
export type CofrinhoSettings = AgentSettingsOf<"cofrinho">;

export interface BuiltinAgentInfo {
	key: BuiltinAgentKey;
	name: string;
	/** Uma linha (o subtítulo do Figma). */
	tagline: string;
	/** O que o agente vigia, em frases curtas (a lista da tela). */
	watches: readonly string[];
	defaultEnabled: boolean;
	defaultSchedule: AgentSchedule;
	defaultSettings: Record<string, unknown>;
	/** A Órbita é a principal: não desliga, não tem agenda nem avisos próprios. */
	alwaysOn: boolean;
}

export const BUILTIN_AGENTS: Readonly<Record<BuiltinAgentKey, BuiltinAgentInfo>> = {
	orbita: {
		key: "orbita",
		name: "Órbita",
		tagline: "Coordena os outros agentes, lança gastos, lê comprovantes e responde no chat.",
		watches: ["Lança gastos pelo chat", "Categoriza com a sua confirmação", "Responde sobre o seu dinheiro"],
		defaultEnabled: true,
		defaultSchedule: { frequency: "daily", hour: 8, day: null },
		defaultSettings: {},
		alwaysOn: true,
	},
	vigia: {
		key: "vigia",
		name: "Vigia",
		tagline: "Avisa quando um gasto foge do orçamento ou do seu jeito de gastar.",
		watches: [
			"Gasto fora do comum numa categoria",
			"Cobrança repetida no mesmo estabelecimento",
			"Categoria que passou do percentual do orçamento",
		],
		defaultEnabled: false,
		defaultSchedule: { frequency: "daily", hour: 9, day: null },
		defaultSettings: {
			unusualSpending: true,
			unusualMinCents: 30000,
			duplicateCharge: true,
			duplicateWindowDays: 3,
			budgetThreshold: true,
		},
		alwaysOn: false,
	},
	fechamento: {
		key: "fechamento",
		name: "Fechamento",
		tagline: "Manda o resumo do mês e compara com o período anterior.",
		watches: ["Resumo do mês que fechou", "Comparação com o mês anterior", "Para onde pode ir a sobra"],
		defaultEnabled: false,
		defaultSchedule: { frequency: "monthly", hour: 8, day: 1 },
		defaultSettings: { monthlySummary: true, compareWithPrevious: true, suggestLeftover: true },
		alwaysOn: false,
	},
	metas: {
		key: "metas",
		name: "Metas",
		tagline: "Acompanha suas metas, avisa quando sair do ritmo e diz se vai dar tempo.",
		watches: ["Metas no ritmo ou atrasadas", "Quanto guardar por mês para chegar no prazo"],
		defaultEnabled: false,
		defaultSchedule: { frequency: "weekly", hour: 9, day: 1 },
		defaultSettings: { warnBehind: true },
		alwaysOn: false,
	},
	caca_assinatura: {
		key: "caca_assinatura",
		name: "Caça-assinatura",
		tagline: "Encontra cobranças que se repetem e avisa quando o preço sobe.",
		watches: ["Cobrança mensal que ainda não está nas Assinaturas", "Assinatura que ficou mais cara"],
		defaultEnabled: false,
		defaultSchedule: { frequency: "weekly", hour: 9, day: 1 },
		defaultSettings: { findRecurring: true, priceIncrease: true },
		alwaysOn: false,
	},
	cofrinho: {
		key: "cofrinho",
		name: "Cofrinho",
		tagline: "Sugere quanto guardar neste mês. Só sugere: não move dinheiro.",
		watches: ["O que dá para guardar com o orçamento e as contas que ainda vão cair"],
		defaultEnabled: false,
		defaultSchedule: { frequency: "monthly", hour: 9, day: 5 },
		defaultSettings: { suggestSaving: true, minCents: 10000 },
		alwaysOn: false,
	},
};

/** Como cada agente da casa nasce no banco (`AgentStore.ensureBuiltins`). */
export function builtinAgentSeeds() {
	return BUILTIN_AGENT_KEYS.map((key) => {
		const info = BUILTIN_AGENTS[key];
		return {
			builtinKey: key,
			name: info.name,
			enabled: info.defaultEnabled,
			frequency: info.defaultSchedule.frequency,
			runHour: info.defaultSchedule.hour,
			runDay: info.defaultSchedule.day,
			settings: { ...info.defaultSettings },
		};
	});
}

export const isBuiltinAgentKey = (value: unknown): value is BuiltinAgentKey =>
	typeof value === "string" && (BUILTIN_AGENT_KEYS as readonly string[]).includes(value);

// ---------------------------------------------------------------------- DTOs

export const alertSchema = z.object({
	id: idSchema,
	agentId: idSchema,
	agentName: z.string(),
	kind: z.enum(ALERT_KINDS),
	title: z.string(),
	body: z.string(),
	/** `true` quando a IA reescreveu o texto; `false` é o texto-modelo. */
	wordedByAi: z.boolean(),
	status: z.enum(ALERT_STATUSES),
	transactionId: z.string().nullable(),
	proposalId: z.string().nullable(),
	createdAt: timestampSchema,
});
export type AlertDto = z.infer<typeof alertSchema>;

export const agentSchema = z.object({
	id: idSchema,
	/** `null` = agente criado pelo dono. */
	builtinKey: z.enum(BUILTIN_AGENT_KEYS).nullable(),
	name: z.string(),
	/** Subtítulo: o do catálogo (da casa) ou o começo das instruções (do dono). */
	tagline: z.string(),
	watches: z.array(z.string()),
	/** Só agente do dono. */
	instructions: z.string().nullable(),
	tools: z.array(z.string()),
	enabled: z.boolean(),
	alwaysOn: z.boolean(),
	schedule: agentScheduleSchema,
	settings: z.record(z.string(), z.unknown()),
	/** Modelo escolhido só para este agente; `null` = o padrão do servidor. */
	model: z.string().nullable(),
	lastRunAt: timestampSchema.nullable(),
	alertsNew: z.number().int(),
	latestAlert: alertSchema.nullable(),
});
export type AgentDto = z.infer<typeof agentSchema>;

export interface AgentsListResponse {
	agents: AgentDto[];
}
export interface AgentDetailResponse {
	agent: AgentDto;
	alerts: AlertDto[];
}
export interface AlertsListResponse {
	alerts: AlertDto[];
}

// ------------------------------------------------------------------- pedidos

const agentNameSchema = z
	.string({ error: "Informe o nome do agente." })
	.trim()
	.min(1, "Informe o nome do agente.")
	.max(AGENT_NAME_MAX, `O nome tem até ${AGENT_NAME_MAX} letras.`);
const agentInstructionsSchema = z
	.string({ error: "Diga o que o agente deve fazer." })
	.trim()
	.min(1, "Diga o que o agente deve fazer.")
	.max(AGENT_INSTRUCTIONS_MAX, `As instruções têm até ${AGENT_INSTRUCTIONS_MAX} letras.`);
const agentToolsSchema = z
	.array(z.string().refine((n) => AGENT_TOOL_NAMES.includes(n), "Ferramenta desconhecida."))
	.min(1, "Escolha ao menos uma coisa para o agente ler.")
	.max(AGENT_TOOLS_MAX)
	.refine((list) => new Set(list).size === list.length, "Ferramenta repetida.");

export const customAgentCreateBody = z
	.object({
		name: agentNameSchema,
		instructions: agentInstructionsSchema,
		tools: agentToolsSchema,
		schedule: agentScheduleSchema,
	})
	.strict();
export type CustomAgentCreateBody = z.infer<typeof customAgentCreateBody>;

/** Campos ausentes ficam como estão. `model: null` volta ao padrão. Nome, instruções e ferramentas são só de agente do dono. */
export const agentUpdateBody = z
	.object({
		enabled: z.boolean(),
		settings: z.record(z.string(), z.unknown()),
		model: z.string().min(1).max(80).nullable(),
		schedule: agentScheduleSchema,
		name: agentNameSchema,
		instructions: agentInstructionsSchema,
		tools: agentToolsSchema,
	})
	.partial()
	.strict()
	.refine((v) => Object.keys(v).length > 0, "Envie ao menos um campo para mudar.");
export type AgentUpdateBody = z.infer<typeof agentUpdateBody>;

export const alertsQuery = z.object({
	status: z.enum(ALERT_STATUSES).optional(),
	agentId: idSchema.optional(),
	limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type AlertsQuery = z.infer<typeof alertsQuery>;
