import type { AgentFrequency, AlertKind, AlertStatus, BuiltinAgentKey } from "@orbita/shared";

export interface AgentRecord {
	id: string;
	/** `null` = agente criado pelo dono. */
	builtinKey: BuiltinAgentKey | null;
	name: string;
	/** Só do dono: o que ele escreveu para o agente fazer. */
	instructions: string | null;
	/** Só do dono: nomes das ferramentas de leitura que o agente pode chamar. */
	tools: string[];
	enabled: boolean;
	frequency: AgentFrequency;
	/** Hora cheia (0 a 23), fuso de São Paulo. */
	runHour: number;
	/** Semanal: 0 (domingo) a 6. Mensal: 1 a 28. Diário: `null`. */
	runDay: number | null;
	/** Escolhas do agente (opaco aqui; a API valida com `agentSettingsSchemas`). */
	settings: Record<string, unknown>;
	/** Modelo só deste agente; `null` = padrão do servidor. */
	model: string | null;
	lastRunAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
}

/** Um agente da casa, como nasce (o catálogo vem de `BUILTIN_AGENTS`). */
export interface BuiltinAgentSeed {
	builtinKey: BuiltinAgentKey;
	name: string;
	enabled: boolean;
	frequency: AgentFrequency;
	runHour: number;
	runDay: number | null;
	settings: Record<string, unknown>;
}

export interface CustomAgentInput {
	name: string;
	instructions: string;
	tools: readonly string[];
	frequency: AgentFrequency;
	runHour: number;
	runDay: number | null;
}

export type AgentPatch = Partial<{
	/** Só de agente do dono. */
	name: string;
	/** Só de agente do dono. */
	instructions: string;
	/** Só de agente do dono. */
	tools: readonly string[];
	enabled: boolean;
	frequency: AgentFrequency;
	runHour: number;
	runDay: number | null;
	settings: Record<string, unknown>;
	model: string | null;
}>;

export interface AlertRecord {
	id: string;
	agentId: string;
	kind: AlertKind;
	/** Identifica o achado dentro do agente: o par (agente, chave) é único. */
	dedupeKey: string;
	title: string;
	body: string;
	wordedByAi: boolean;
	/** Números do achado (centavos inteiros). */
	data: Record<string, unknown>;
	status: AlertStatus;
	proposalId: string | null;
	transactionId: string | null;
	createdAt: Date;
	seenAt: Date | null;
	dismissedAt: Date | null;
}

export interface AlertDraft {
	kind: AlertKind;
	dedupeKey: string;
	title: string;
	body: string;
	data?: Record<string, unknown>;
	transactionId?: string | null;
	proposalId?: string | null;
}

export interface AlertQuery {
	status?: AlertStatus | undefined;
	agentId?: string | undefined;
	/** Padrão 30, máximo 100. */
	limit?: number | undefined;
}

export const AGENT_DEDUPE_KEY_MAX = 200;

/**
 * Agentes e os avisos que eles geram. `not_found` para agente ou aviso que não existe; `invalid` para dado fora das
 * regras (nome, agenda, ferramentas) ou para mexer no que só o dono tem (nome, instruções, ferramentas) num agente
 * da casa, e para apagar um agente da casa.
 */
export interface AgentStore {
	/** Cria os agentes da casa que ainda não existem (por `builtinKey`); os que existem ficam como estão. Idempotente. */
	ensureBuiltins(seeds: readonly BuiltinAgentSeed[]): Promise<void>;
	/** Da casa primeiro (na ordem em que nasceram), depois os do dono, do mais antigo ao mais novo. */
	list(): Promise<AgentRecord[]>;
	get(id: string): Promise<AgentRecord | null>;
	createCustom(input: CustomAgentInput): Promise<AgentRecord>;
	update(id: string, patch: AgentPatch): Promise<AgentRecord>;
	/** Só agente do dono; apaga também os avisos dele. `true` se existia. */
	deleteCustom(id: string): Promise<boolean>;
	/** Anota que o agente rodou (o worker usa para saber o que já foi feito no período). */
	markRun(id: string, at: Date): Promise<void>;

	/**
	 * Grava os avisos que ainda não existem para o agente (por `dedupeKey`) e devolve SÓ os novos. Um achado que já
	 * existe, mesmo dispensado, não é recriado: rodar de novo no mesmo período não duplica nada.
	 */
	addAlerts(agentId: string, drafts: readonly AlertDraft[]): Promise<AlertRecord[]>;
	/** Do mais novo para o mais antigo. */
	listAlerts(query?: AlertQuery): Promise<AlertRecord[]>;
	getAlert(id: string): Promise<AlertRecord | null>;
	/** `seen` só sai de `new`; `dismissed` sai de qualquer um. Repetir não muda o carimbo. `null` se não existe. */
	setAlertStatus(id: string, status: "seen" | "dismissed"): Promise<AlertRecord | null>;
	/** Troca o texto (a IA reescreveu). `null` se não existe. */
	setAlertBody(id: string, body: string, wordedByAi: boolean): Promise<AlertRecord | null>;
	/** Quantos avisos novos cada agente tem (só os que têm). */
	countNewByAgent(): Promise<Record<string, number>>;
}
