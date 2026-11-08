import type { Cents } from "@orbita/core";
import { chart, defaultCategoryColor } from "@orbita/tokens";
import { bankLogoKey } from "../../lib/bank-logos.ts";

/** Passos depois das boas-vindas: servidor, bancos, notificações, orçamento. */
export const ONBOARDING_STEPS = 4 as const;

export type OnboardingStep = 1 | 2 | 3 | 4;

export function progressLabel(step: OnboardingStep): string {
	return `${step} de ${ONBOARDING_STEPS}`;
}

/** Limite do plano pessoal do Meu Pluggy, o "N de 5" da tela de bancos. */
export const PLUGGY_CONNECTION_LIMIT = 5;

/** Bancos da tela de primeira vez, na ordem do Figma. */
export const ONBOARDING_BANKS = [
	"Nubank",
	"Inter",
	"Santander",
	"Mercado Pago",
	"Itaú",
	"C6 Bank",
	"PicPay",
	"Bradesco",
] as const;

export interface BankRow {
	name: (typeof ONBOARDING_BANKS)[number];
	connected: boolean;
}

/** Uma conexão conta para o banco quando os dois resolvem o mesmo logo. */
export function bankRows(connectionNames: readonly string[]): BankRow[] {
	const logos = new Set(
		connectionNames.flatMap((name) => {
			const logo = bankLogoKey({ name });
			return logo ? [logo] : [];
		}),
	);
	return ONBOARDING_BANKS.map((name) => {
		const logo = bankLogoKey({ name });
		return { name, connected: logo !== null && logos.has(logo) };
	});
}

export function connectionsUsedLabel(connected: number): string {
	const n = Math.max(0, Math.min(PLUGGY_CONNECTION_LIMIT, connected));
	return `${n} de ${PLUGGY_CONNECTION_LIMIT} conexões usadas`;
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
