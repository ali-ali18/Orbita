import type { Cents } from "@orbita/core";
import { chart, defaultCategoryColor } from "@orbita/tokens";
import { type BankLogoKey, bankLogoKey } from "../../lib/bank-logos.ts";
import type { OnboardingLogoId } from "./bank-svgs.ts";

/** Passos depois das boas-vindas: servidor, bancos, notificações, orçamento. */
export const ONBOARDING_STEPS = 4 as const;

/** Gravado no cofre quando a pessoa terminou os passos. */
export const ONBOARDING_DONE = "done";

/**
 * Gravado quando a pessoa começa agora (boas-vindas). Depois de parear, os passos abrem sozinhos.
 * Quem já usava o app não tem esse valor: a entrada fica nas configurações.
 */
export const ONBOARDING_PENDING = "pending";

export type OnboardingPhase = "done" | "pending" | "available";

/** `null` e qualquer outro texto = já estava no app e não fez os passos. */
export function onboardingPhase(stored: string | null): OnboardingPhase {
	if (stored === ONBOARDING_DONE) return "done";
	if (stored === ONBOARDING_PENDING) return "pending";
	return "available";
}

/** Quem está entrando agora vê bancos, notificações e orçamento logo depois de parear. */
export function showsAutomaticSetup(phase: OnboardingPhase): boolean {
	return phase === "pending";
}

/** Quem já entrou e não fez (o fluxo não existia, ou um bug) encontra a opção nas configurações. Feito, some. */
export function showsSetupInSettings(phase: OnboardingPhase): boolean {
	return phase === "available";
}

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
	logo: OnboardingLogoId;
	connected: boolean;
	/** Só o Meu Pluggy abre o Pluggy Connect. Os bancos da lista não têm conector próprio no plano pessoal. */
	connectable: boolean;
}

/** Os oito bancos da tela original, e o Meu Pluggy por último: é a conexão que o plano pessoal abre. */
const ONBOARDING_BANKS: readonly { name: string; logo: OnboardingLogoId; ispb: BankLogoKey }[] = [
	{ name: "Nubank", logo: "nubank", ispb: "18236120" },
	{ name: "Inter", logo: "inter", ispb: "00416968" },
	{ name: "Santander", logo: "santander", ispb: "90400888" },
	{ name: "Mercado Pago", logo: "mercadopago", ispb: "10573521" },
	{ name: "Itaú", logo: "itau", ispb: "60701190" },
	{ name: "C6 Bank", logo: "c6", ispb: "31872495" },
	{ name: "PicPay", logo: "picpay", ispb: "22896431" },
	{ name: "Bradesco", logo: "bradesco", ispb: "60746948" },
];

/**
 * Lista da primeira vez. Um banco fica conectado quando o nome de alguma conexão é o dele.
 * O Meu Pluggy fica conectado quando já existe qualquer conexão.
 */
export function onboardingBankRows(labels: readonly (string | null | undefined)[]): BankRow[] {
	const matched = new Set(
		labels.map((label) => bankLogoKey({ name: label })).filter((key): key is BankLogoKey => key !== null),
	);
	return [
		...ONBOARDING_BANKS.map((bank) => ({
			name: bank.name,
			logo: bank.logo,
			connected: matched.has(bank.ispb),
			connectable: false,
		})),
		{
			name: MEU_PLUGGY_NAME,
			logo: "meu-pluggy",
			connected: labels.length > 0,
			connectable: true,
		},
	];
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
