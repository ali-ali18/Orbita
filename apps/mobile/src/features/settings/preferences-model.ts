import { NOTIFICATION_APPS, type NotificationApp } from "@orbita/shared";

/** Lógica pura das telas Preferências e Notificações do celular. */

interface AccountLike {
	id: string;
	name: string;
	archivedAt: string | null;
}

/** Contas que podem ser a padrão: só as ativas, na ordem em que a API manda. */
export const selectableAccounts = <T extends AccountLike>(accounts: readonly T[]): T[] =>
	accounts.filter((a) => a.archivedAt === null);

/** Valor da linha "Conta padrão": o nome da conta, ou "Nenhuma" (sem preferência ou conta que sumiu/arquivou). */
export function defaultAccountLabel(accounts: readonly AccountLike[], id: string | null): string {
	if (id === null) return "Nenhuma";
	const account = accounts.find((a) => a.id === id && a.archivedAt === null);
	return account ? account.name : "Nenhuma";
}

/**
 * Valor da linha "Sobra do mês vai para": o nome da meta ou da conta escolhida (nunca as duas), ou "Nenhuma" se
 * não há escolha ou o que foi escolhido sumiu ou foi arquivado.
 */
export function leftoverLabel(
	accounts: readonly AccountLike[],
	goals: readonly AccountLike[],
	choice: { accountId: string | null; goalId: string | null },
): string {
	if (choice.goalId !== null) {
		const goal = goals.find((g) => g.id === choice.goalId && g.archivedAt === null);
		return goal ? goal.name : "Nenhuma";
	}
	return defaultAccountLabel(accounts, choice.accountId);
}

/** Liga ou desliga um app da lista de leitura, mantendo a ordem fixa e sem repetir. */
export function toggleApp(apps: readonly NotificationApp[], app: NotificationApp): NotificationApp[] {
	const next = apps.includes(app) ? apps.filter((a) => a !== app) : [...apps, app];
	return NOTIFICATION_APPS.filter((a) => next.includes(a));
}

export const ALERTS_SOON = "Os avisos dependem de notificações do próprio app, que ainda não existem.";
