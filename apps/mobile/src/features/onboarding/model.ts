import type { Cents } from "@orbita/core";
import { chart, defaultCategoryColor } from "@orbita/tokens";

/** Passos depois das boas-vindas: servidor, bancos, notificações, orçamento. */
export const ONBOARDING_STEPS = 4 as const;

export type OnboardingStep = 1 | 2 | 3 | 4;

export function progressLabel(step: OnboardingStep): string {
	return `${step} de ${ONBOARDING_STEPS}`;
}

/**
 * Sem a API paga o Pluggy não deixa conectar cada banco. O plano pessoal entra por uma conexão só,
 * o conector Meu Pluggy, que libera as contas e os cartões.
 */
export const MEU_PLUGGY_NAME = "Meu Pluggy";

export interface BankRow {
	name: string;
	connected: boolean;
}

/** A única linha da primeira vez: conectada quando já existe ao menos uma conexão cadastrada. */
export function meuPluggyRow(connectionCount: number): BankRow {
	return { name: MEU_PLUGGY_NAME, connected: connectionCount > 0 };
}

export function connectionsUsedLabel(connected: boolean): string {
	return connected ? "1 de 1 conexão" : "0 de 1 conexão";
}

export const SUGGESTED_TOTAL_CENTS = 300_000;
export const SUGGESTED_AVERAGE_CENTS = 324_000;
export const BUDGET_STEP_CENTS = 10_000;
export const BUDGET_MIN_CENTS = 100_000;
export const BUDGET_MAX_CENTS = 5_000_000;

/** Partes da sugestão do Figma (somam o total sugerido). A última absorve o resto ao escalar. */
const SPLIT: readonly { name: string; cents: Cents; color: string }[] = [
	{ name: "Mercado", cents: 90_000, color: defaultCategoryColor.mercado },
	{ name: "Delivery", cents: 50_000, color: defaultCategoryColor.delivery },
	{ name: "Transporte", cents: 40_000, color: defaultCategoryColor.transporte },
	{ name: "Assinaturas", cents: 25_000, color: defaultCategoryColor.assinaturas },
	{ name: "Lazer", cents: 40_000, color: defaultCategoryColor.lazer },
	{ name: "Outros", cents: 55_000, color: chart.other },
];

export interface SplitRow {
	name: string;
	cents: Cents;
	color: string;
}

export function stepBudget(current: Cents, direction: -1 | 1): Cents {
	const next = current + direction * BUDGET_STEP_CENTS;
	return Math.min(BUDGET_MAX_CENTS, Math.max(BUDGET_MIN_CENTS, next));
}

/** Divide `totalCents` nas mesmas proporções da sugestão. A soma fecha no total. */
export function splitBudget(totalCents: Cents): SplitRow[] {
	const base = SPLIT.reduce((s, row) => s + row.cents, 0);
	let used = 0;
	return SPLIT.map((row, index) => {
		const cents =
			index === SPLIT.length - 1 ? totalCents - used : Math.floor((totalCents * row.cents) / base);
		used += cents;
		return { name: row.name, cents, color: row.color };
	});
}
