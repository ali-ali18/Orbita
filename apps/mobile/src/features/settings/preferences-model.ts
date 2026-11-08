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

/** Liga ou desliga um app da lista de leitura, mantendo a ordem fixa e sem repetir. */
export function toggleApp(apps: readonly NotificationApp[], app: NotificationApp): NotificationApp[] {
	const next = apps.includes(app) ? apps.filter((a) => a !== app) : [...apps, app];
	return NOTIFICATION_APPS.filter((a) => next.includes(a));
}

/** Aviso fixo da tela de notificações: a leitura do banco ainda não existe. */
export const NOTIFICATION_STATUS = "Ainda não leio as notificações do banco.";
export const NOTIFICATION_STATUS_DETAIL =
	"Suas escolhas ficam guardadas no servidor e passam a valer quando a leitura estiver pronta.";

export const ALERTS_SOON = "Os avisos dependem de notificações do próprio app, que ainda não existem.";
