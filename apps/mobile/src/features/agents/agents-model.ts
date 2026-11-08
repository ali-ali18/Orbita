import type { LocalDate } from "@orbita/core";
import {
	AGENT_NAME_MAX,
	AGENT_TOOL_OPTIONS,
	type AgentDto,
	type AgentSchedule,
	type AlertDto,
	type BuiltinAgentKey,
	type CustomAgentCreateBody,
} from "@orbita/shared";
import type { AgentVisualKey } from "@orbita/tokens";
import { dayMonth, formatWholeReais, saoPauloStamp } from "../../lib/format.ts";

/*
 * Lógica pura das telas de agentes: o que mostrar, em que ordem e como montar o pedido. Quem decide os avisos é o
 * worker (engine); o app só lê, liga e desliga, e abre a conversa. Nenhum número de dinheiro é calculado aqui.
 */

/** A cor do agente (o rosto e o tom do cartão) vem de `@orbita/tokens`. */
export const visualKey = (agent: Pick<AgentDto, "builtinKey">): AgentVisualKey =>
	agent.builtinKey ?? "custom";

// ----------------------------------------------------------------- lista

/** O dono liga os da casa; os que ele criou nascem ligados. A Órbita é sempre ativa. */
export const isActive = (agent: Pick<AgentDto, "enabled">): boolean => agent.enabled;

export function splitAgents<T extends Pick<AgentDto, "enabled">>(
	agents: readonly T[],
): { active: T[]; toActivate: T[] } {
	return { active: agents.filter(isActive), toActivate: agents.filter((a) => !isActive(a)) };
}

export const activeCountLabel = (count: number): string => (count === 1 ? "1 ativo" : `${count} ativos`);

/** Legenda de uma linha da lista: o último aviso, ou o que o agente faz. */
export function previewOf(agent: Pick<AgentDto, "tagline" | "latestAlert">): string {
	return agent.latestAlert ? agent.latestAlert.title : agent.tagline;
}

/** "Agora" (menos de 1 min), a hora no mesmo dia ("09:30"), "ontem" ou "1 de nov". Sem aviso, vazio. */
export function whenLabel(iso: string, now: Date, today: LocalDate): string {
	const stamp = saoPauloStamp(iso);
	if (!stamp) return "";
	if (now.getTime() - new Date(iso).getTime() < 60_000) return "Agora";
	if (stamp.date === today) return stamp.time;
	return dayMonth(stamp.date);
}

// -------------------------------------------------------------- agenda

const WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"] as const;
export const WEEKDAY_OPTIONS = WEEKDAYS.map((name, day) => ({ day, name }));

const hourText = (hour: number) => `${hour}h`;

/** "todo dia, 9h", "toda segunda, 9h", "todo dia 5, 9h". */
export function scheduleLabel(schedule: AgentSchedule): string {
	switch (schedule.frequency) {
		case "daily":
			return `todo dia, ${hourText(schedule.hour)}`;
		case "weekly": {
			const day = WEEKDAYS[schedule.day ?? 0] ?? "segunda";
			const article = day === "sábado" || day === "domingo" ? "todo" : "toda";
			return `${article} ${day}, ${hourText(schedule.hour)}`;
		}
		case "monthly":
			return `todo dia ${schedule.day ?? 1}, ${hourText(schedule.hour)}`;
	}
}

export const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => ({ hour, label: hourText(hour) }));
export const MONTH_DAY_OPTIONS = Array.from({ length: 28 }, (_, i) => i + 1);

export const FREQUENCY_OPTIONS = [
	{ value: "daily", label: "Todo dia" },
	{ value: "weekly", label: "Toda semana" },
	{ value: "monthly", label: "Todo mês" },
] as const;

/** Ao trocar a frequência, o dia volta a um valor que existe nela (diário não tem dia). */
export function withFrequency(schedule: AgentSchedule, frequency: AgentSchedule["frequency"]): AgentSchedule {
	if (frequency === schedule.frequency) return schedule;
	const day = frequency === "daily" ? null : frequency === "weekly" ? 1 : 1;
	return { frequency, hour: schedule.hour, day };
}

// --------------------------------------------------------- escolhas do agente

export interface SettingRow {
	/** Chave em `settings`. */
	key: string;
	label: string;
	caption?: string;
	/** `toggle` liga e desliga; `cents` abre o teclado de valor; `days` abre a escolha de dias. */
	kind: "toggle" | "cents" | "days";
	/** Para `cents`: o mínimo que o servidor aceita, em centavos. */
	min?: number;
}

type Settings = Record<string, unknown>;

/** As linhas de "O que eu vigio / faço" de cada agente da casa (o que existe de verdade no servidor). */
export function settingRows(key: BuiltinAgentKey): SettingRow[] {
	switch (key) {
		case "vigia":
			return [
				{
					key: "unusualSpending",
					label: "Gasto fora do comum",
					caption: "Bem acima do usual da categoria",
					kind: "toggle",
				},
				{
					key: "unusualMinCents",
					label: "Gasto grande de uma vez",
					caption: "Só olho a partir deste valor",
					kind: "cents",
					min: 100,
				},
				{
					key: "duplicateCharge",
					label: "Cobrança repetida",
					caption: "Mesmo lugar e mesmo valor",
					kind: "toggle",
				},
				{ key: "duplicateWindowDays", label: "Prazo da cobrança repetida", kind: "days" },
				{
					key: "budgetThreshold",
					label: "Orçamento por categoria",
					caption: "Aviso quando passar do percentual das Preferências",
					kind: "toggle",
				},
			];
		case "fechamento":
			return [
				{ key: "monthlySummary", label: "Resumo do mês", kind: "toggle" },
				{ key: "compareWithPrevious", label: "Comparar com o período anterior", kind: "toggle" },
				{
					key: "suggestLeftover",
					label: "Sugerir para onde vai a sobra",
					caption: "Só sugiro: não movo dinheiro",
					kind: "toggle",
				},
			];
		case "metas":
			return [{ key: "warnBehind", label: "Avisar se uma meta atrasar", kind: "toggle" }];
		case "caca_assinatura":
			return [
				{ key: "findRecurring", label: "Achar cobranças que se repetem", kind: "toggle" },
				{ key: "priceIncrease", label: "Avisar quando o preço sobe", kind: "toggle" },
			];
		case "cofrinho":
			return [
				{
					key: "suggestSaving",
					label: "Sugerir quanto guardar",
					caption: "Só sugiro: não movo dinheiro",
					kind: "toggle",
				},
				{ key: "minCents", label: "Só sugerir a partir de", kind: "cents", min: 100 },
			];
		case "orbita":
			return [];
	}
}

/** Título da seção das linhas (o Figma usa "O que eu vigio" no Vigia e "O que eu faço" nos outros). */
export const settingsTitle = (key: BuiltinAgentKey): string =>
	key === "vigia" ? "O que eu vigio" : "O que eu faço";

export const DUPLICATE_DAY_OPTIONS = [1, 2, 3, 5, 7, 14] as const;
export const daysLabel = (days: number): string => (days === 1 ? "1 dia" : `${days} dias`);

export function settingValue(row: SettingRow, settings: Settings): string | undefined {
	const value = settings[row.key];
	if (row.kind === "cents" && typeof value === "number") return formatWholeReais(value);
	if (row.kind === "days" && typeof value === "number") return daysLabel(value);
	return undefined;
}

export const settingOn = (row: SettingRow, settings: Settings): boolean => settings[row.key] === true;

// ------------------------------------------------------------------- avisos

export const ALERT_EMPTY = "Nada por aqui ainda. Quando eu achar algo, aparece aqui.";
export const ALERT_EMPTY_OFF = "Ative o agente para eu começar a avisar.";

/** Avisos que ainda não foram dispensados, do mais novo para o mais antigo (a API já ordena). */
export const visibleAlerts = <T extends Pick<AlertDto, "status">>(alerts: readonly T[]): T[] =>
	alerts.filter((a) => a.status !== "dismissed");

// -------------------------------------------------------------- criar agente

export const CREATE_EXAMPLES = [
	"Me avisa quando eu gastar mais de R$ 200 em bar no fim de semana",
	"Avisa se a conta de luz vier alta",
	"Acompanha minha meta de viagem",
] as const;

/** O que um agente novo pode ler por padrão; o dono ajusta em "Ajustar". */
export const DEFAULT_TOOLS: readonly string[] = [
	"get_month_summary",
	"search_transactions",
	"get_budget_status",
	"list_catalog",
];

export const DEFAULT_CREATE_SCHEDULE: AgentSchedule = { frequency: "daily", hour: 9, day: null };

export const toolLabel = (name: string): string =>
	AGENT_TOOL_OPTIONS.find((t) => t.name === name)?.label ?? name;

export interface CreateDraft {
	instructions: string;
	/** `null` = o nome sugerido pelo texto. */
	name: string | null;
	tools: readonly string[];
	schedule: AgentSchedule;
}

export const initialDraft = (instructions = ""): CreateDraft => ({
	instructions,
	name: null,
	tools: DEFAULT_TOOLS,
	schedule: DEFAULT_CREATE_SCHEDULE,
});

/** Nome sugerido: as primeiras palavras da frase, sem pontuação no fim, com a primeira letra maiúscula. */
export function suggestName(instructions: string): string {
	const words = instructions
		.replace(/[.!?]+$/u, "")
		.trim()
		.split(/\s+/u)
		.filter((w) => w.length > 0)
		.slice(0, 4);
	let name = words.join(" ");
	if (name.length > AGENT_NAME_MAX) name = `${name.slice(0, AGENT_NAME_MAX - 1).trimEnd()}…`;
	return name.length === 0 ? "" : `${name.charAt(0).toLocaleUpperCase("pt-BR")}${name.slice(1)}`;
}

export const draftName = (draft: CreateDraft): string =>
	draft.name?.trim() || suggestName(draft.instructions);

export type DraftCheck = { ok: true; body: CustomAgentCreateBody } | { ok: false; message: string };

/** Confere o rascunho e monta o pedido; o servidor valida de novo (o app não é a barreira). */
export function checkDraft(draft: CreateDraft): DraftCheck {
	const instructions = draft.instructions.trim();
	if (instructions.length === 0)
		return { ok: false, message: "Diga em uma frase o que o agente deve fazer." };
	const name = draftName(draft);
	if (name.length === 0) return { ok: false, message: "Dê um nome ao agente." };
	if (draft.tools.length === 0)
		return { ok: false, message: "Escolha ao menos uma coisa para o agente ler." };
	return { ok: true, body: { name, instructions, tools: [...draft.tools], schedule: draft.schedule } };
}

/** "Resumo do mês, Lançamentos e mais 2" (o que o agente lê, para a prévia). */
export function toolsSummary(tools: readonly string[]): string {
	const labels = tools.map(toolLabel);
	if (labels.length <= 2) return labels.join(" e ");
	return `${labels.slice(0, 2).join(", ")} e mais ${labels.length - 2}`;
}

/** Chaves de consulta que mudam quando um agente ou um aviso muda. */
export function isAffectedByAgents(queryKey: readonly unknown[], baseUrl: string): boolean {
	return queryKey[0] === baseUrl && (queryKey[1] === "agents" || queryKey[1] === "alerts");
}

/** Explica o botão "Configurar com a Órbita" da tela da Órbita. */
export const SETUP_ENTRY_NOTE =
	"Analiso o seu histórico e proponho assinaturas, categorias e renda. Você marca o que quer e confirma.";
