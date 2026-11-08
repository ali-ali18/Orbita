import type { MonthKey } from "@orbita/core";

export interface IncomeSourceRecord {
	id: string;
	name: string;
	/** Líquido, em centavos. */
	amountCents: number;
	/** Dia do mês (1 a 31); em mês curto o engine cai no último dia. */
	payday: number;
	/** Conta onde o dinheiro cai (só informação). */
	accountId: string | null;
	/** `true` = todo mês (salário); `false` = só no `month` (um freela). */
	recurring: boolean;
	/** Mês da fonte avulsa; sempre `null` quando `recurring`. */
	month: MonthKey | null;
	archivedAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface IncomeSourceInput {
	name: string;
	amountCents: number;
	payday: number;
	accountId?: string | null;
	recurring?: boolean;
	month?: MonthKey | null;
}

export type IncomeSourcePatch = Partial<{
	name: string;
	amountCents: number;
	payday: number;
	accountId: string | null;
	recurring: boolean;
	month: MonthKey | null;
}>;

/**
 * Fontes de renda: o salário e outras entradas (freelas). O que entra no mês e o próximo pagamento são contas do
 * engine (`incomeForMonth`, `nextPayday` em `@orbita/core`).
 */
export interface IncomeSourceStore {
	/** `bad_reference` para conta inexistente ou arquivada; `invalid` para dado fora da regra. */
	create(input: IncomeSourceInput): Promise<IncomeSourceRecord>;
	/** `not_found` se não existe; `invalid` se está arquivada. */
	update(id: string, patch: IncomeSourcePatch): Promise<IncomeSourceRecord>;
	/** Esconde da lista. Idempotente. */
	archive(id: string): Promise<IncomeSourceRecord>;
	/** Só as ativas, da mais antiga para a mais nova. */
	list(): Promise<IncomeSourceRecord[]>;
	/** Também devolve arquivada. */
	get(id: string): Promise<IncomeSourceRecord | null>;
}
