export const TOTAL_BUDGET_SCOPE = "total";

export interface BudgetRecord {
	/** "total" ou o id de uma categoria. */
	scope: string;
	limitCents: number;
	updatedAt: Date;
}

export interface BudgetStore {
	/** Cria ou troca o limite. O escopo é "total" ou o id de uma categoria existente. */
	set(scope: string, limitCents: number): Promise<BudgetRecord>;
	/** `true` se existia. */
	remove(scope: string): Promise<boolean>;
	list(): Promise<BudgetRecord[]>;
}
