import type { AutonomousActionKind } from "@orbita/core";

/*
 * Registro de atividades do agente Economia: tudo o que ele fez SOZINHO, com o motivo, a evidência e o que o Desfazer
 * precisa para devolver o estado anterior. É a trilha que o dono vê no app (e a única fonte de verdade do que o agente
 * mexeu). O par (agente, `dedupeKey`) é único: o mesmo achado nunca vira duas ações e, como o que o dono desfez
 * continua no registro, também não volta sozinho.
 */

/**
 * `applying`: reservada e com o `undo` já gravado, mas a ação ainda não foi dada como concluída (está rodando, ou o
 * processo caiu no meio). Não se desfaz enquanto está assim; a próxima passada do agente resolve (`done`, `retry` ou
 * `failed`). `retry`: comprovadamente não gravou e vai ser tentada de novo (o contador fica em `undo.attempts`).
 * `failed`: esgotou as tentativas; fica no registro e não é tentada de novo. Nenhuma das duas se desfaz.
 */
export const ACTIVITY_STATUSES = ["applying", "retry", "done", "undone", "failed"] as const;
/** Quantas tentativas uma ação que falha sempre recebe antes de ficar `failed` (sem novas tentativas). */
export const ACTIVITY_MAX_ATTEMPTS = 3;
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
	/** O que o Desfazer precisa, calculado ANTES de agir: gravado já na reserva, para a mudança nunca ficar sem Desfazer. */
	undo: Record<string, unknown>;
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
	 * Reserva a ação ANTES de executá-la: `null` se o achado já tem registro (feito, desfeito, falha definitiva), e então a
	 * ação não deve ser executada. Um registro `retry` é reaproveitado (volta a `applying`, mantendo o contador). Reservar primeiro é o que impede dois processos de fazerem a mesma coisa.
	 */
	reserve(agentId: string, draft: ActivityDraft): Promise<ActivityRecord | null>;
	/**
	 * A ação foi executada: comparar-e-trocar atômico de `applying` para `done`, completando o `undo` (ids criados).
	 * `null` se o registro não existe ou não está em `applying`.
	 */
	finish(id: string, undo: Record<string, unknown>): Promise<ActivityRecord | null>;
	/** A ação comprovadamente NÃO gravou nada: solta a reserva (o achado pode ser tentado de novo). `true` se existia.
	 * Nunca chamar quando a ação pode ter gravado: o registro fica `applying` e a próxima passada decide. */
	release(id: string): Promise<boolean>;
	/** Do mais novo para o mais antigo. */
	list(query?: ActivityQuery): Promise<ActivityRecord[]>;
	get(id: string): Promise<ActivityRecord | null>;
	/** Todas as chaves já registradas do agente (feitas, desfeitas e falhas definitivas; as `retry` ficam de fora: podem ser tentadas). */
	keys(agentId: string): Promise<Set<string>>;
	/**
	 * Comparar-e-trocar atômico de `done` para `undone`: só uma chamada vence (dois toques seguidos não desfazem duas
	 * vezes). `null` se o registro não existe ou já estava desfeito.
	 */
	markUndone(id: string, note?: string | null): Promise<ActivityRecord | null>;
	/** `applying` → `retry`, com o contador de tentativas no `undo`. `null` se não estava `applying`. */
	markRetry(id: string, undo: Record<string, unknown>): Promise<ActivityRecord | null>;
	/** `applying` → `failed` (esgotou as tentativas). `null` se não estava `applying`. */
	markFailed(id: string, undo: Record<string, unknown>): Promise<ActivityRecord | null>;
	/** Anota por que o Desfazer não mexeu em nada (ou o que deixou como estava). `null` se não existe. */
	setUndoNote(id: string, note: string | null): Promise<ActivityRecord | null>;
	/** O Desfazer falhou no meio: volta a `done`. `null` se não existe. */
	reopen(id: string): Promise<ActivityRecord | null>;
}
