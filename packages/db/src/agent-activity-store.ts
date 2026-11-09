import type { AutonomousActionKind } from "@orbita/core";

/*
 * Registro de atividades do agente Economia: tudo o que ele fez SOZINHO, com o motivo, a evidência e o que o Desfazer
 * precisa para devolver o estado anterior. É a trilha que o dono vê no app (e a única fonte de verdade do que o agente
 * mexeu). O par (agente, `dedupeKey`) é único: o mesmo achado nunca vira duas ações e, como o que o dono desfez
 * continua no registro, também não volta sozinho.
 */

export const ACTIVITY_STATUSES = ["done", "undone"] as const;
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];

export const ACTIVITY_SUMMARY_MAX = 160;
export const ACTIVITY_REASON_MAX = 300;
export const ACTIVITY_KEY_MAX = 200;
export const ACTIVITY_NOTE_MAX = 200;

export interface ActivityRecord {
	id: string;
	agentId: string;
	kind: AutonomousActionKind;
	/** Identifica o achado dentro do agente (ex.: "categorize:<lançamento>"). */
	dedupeKey: string;
	/** O quê, em uma frase ("Categorizei um lançamento"). */
	summary: string;
	/** Por quê. */
	reason: string;
	/** Os lançamentos que sustentam a ação. */
	evidence: { transactionIds: string[] };
	/** O que o Desfazer precisa (estado anterior, ids criados). Opaco para o banco; quem escreve é o ledger. */
	undo: Record<string, unknown>;
	status: ActivityStatus;
	createdAt: Date;
	undoneAt: Date | null;
	/** Quando o Desfazer não pôde mexer em nada (o dono já tinha mudado), o porquê em uma frase. */
	undoNote: string | null;
}

export interface ActivityDraft {
	kind: AutonomousActionKind;
	dedupeKey: string;
	summary: string;
	reason: string;
	evidence: { transactionIds: readonly string[] };
}

export interface ActivityQuery {
	agentId?: string | undefined;
	/** Padrão 30, máximo 100. */
	limit?: number | undefined;
}

/**
 * `not_found` para agente que não existe; `invalid` para ação de tipo desconhecido ou texto fora das regras.
 */
export interface AgentActivityStore {
	/**
	 * Reserva a ação ANTES de executá-la: `null` se o achado já tem registro (feito, ou desfeito pelo dono), e então a
	 * ação não deve ser executada. Reservar primeiro é o que impede dois processos de fazerem a mesma coisa.
	 */
	reserve(agentId: string, draft: ActivityDraft): Promise<ActivityRecord | null>;
	/** Guarda o que o Desfazer precisa, depois que a ação foi executada. `null` se o registro não existe. */
	setUndo(id: string, undo: Record<string, unknown>): Promise<ActivityRecord | null>;
	/** A ação falhou: solta a reserva (o achado pode ser tentado de novo). `true` se existia. */
	release(id: string): Promise<boolean>;
	/** Do mais novo para o mais antigo. */
	list(query?: ActivityQuery): Promise<ActivityRecord[]>;
	get(id: string): Promise<ActivityRecord | null>;
	/** Todas as chaves já registradas do agente (feitas e desfeitas). */
	keys(agentId: string): Promise<Set<string>>;
	/**
	 * Comparar-e-trocar atômico de `done` para `undone`: só uma chamada vence (dois toques seguidos não desfazem duas
	 * vezes). `null` se o registro não existe ou já estava desfeito.
	 */
	markUndone(id: string, note?: string | null): Promise<ActivityRecord | null>;
	/** Anota por que o Desfazer não mexeu em nada (ou o que deixou como estava). `null` se não existe. */
	setUndoNote(id: string, note: string | null): Promise<ActivityRecord | null>;
	/** O Desfazer falhou no meio: volta a `done`. `null` se não existe. */
	reopen(id: string): Promise<ActivityRecord | null>;
}
