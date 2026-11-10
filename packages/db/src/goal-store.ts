import type { GoalIcon } from "@orbita/shared";

export interface GoalRecord {
	id: string;
	name: string;
	targetCents: number;
	/** AAAA-MM-DD; `null` = sem prazo. */
	deadline: string | null;
	/** Conta onde o dinheiro da meta está guardado (só informação). */
	accountId: string | null;
	icon: GoalIcon;
	/** Índice em `chart.series` (0 a 9). */
	chartSlot: number;
	archivedAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface GoalInput {
	/** Id escolhido por quem cria (para reconhecer o próprio registro depois de uma falha); padrão: gerado. */
	id?: string;
	name: string;
	targetCents: number;
	deadline?: string | null;
	accountId?: string | null;
	icon?: GoalIcon;
	chartSlot?: number;
}

export type GoalPatch = Partial<{
	name: string;
	targetCents: number;
	deadline: string | null;
	accountId: string | null;
	icon: GoalIcon;
	chartSlot: number;
}>;

export interface GoalContributionRecord {
	id: string;
	goalId: string;
	amountCents: number;
	/** AAAA-MM-DD. */
	date: string;
	/** Lançamento que originou o "Guardar" (só referência, nunca move dinheiro). */
	transactionId: string | null;
	createdAt: Date;
}

export interface GoalContributionInput {
	amountCents: number;
	date: string;
	transactionId?: string | null;
}

/**
 * Metas e as contribuições. O guardado de uma meta não é gravado: é a soma das contribuições, e quem calcula
 * progresso, valor mensal e projeção é o engine (`@orbita/core`).
 */
export interface GoalStore {
	/** `bad_reference` para conta inexistente ou arquivada. */
	create(input: GoalInput): Promise<GoalRecord>;
	/** `not_found` se não existe; `invalid` se está arquivada. */
	update(id: string, patch: GoalPatch): Promise<GoalRecord>;
	/**
	 * Esconde da lista; as contribuições ficam. Idempotente. Se a sobra do mês apontava para a meta, a escolha
	 * é desfeita (as preferências voltam a "nenhuma").
	 */
	archive(id: string): Promise<GoalRecord>;
	/** Só as ativas, da mais antiga para a mais nova. */
	list(): Promise<GoalRecord[]>;
	/** Também devolve arquivada. */
	get(id: string): Promise<GoalRecord | null>;
	/** `not_found` para meta inexistente; `invalid` se arquivada; `bad_reference` para lançamento inexistente. */
	addContribution(goalId: string, input: GoalContributionInput): Promise<GoalContributionRecord>;
	/** `not_found` se a contribuição não existe nesta meta. */
	removeContribution(goalId: string, contributionId: string): Promise<void>;
	/** Das metas pedidas, da mais recente para a mais antiga (data, depois criação). */
	listContributions(goalIds: readonly string[]): Promise<GoalContributionRecord[]>;
}
