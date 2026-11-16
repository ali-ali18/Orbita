import type { NotificationApp } from "@orbita/shared";

export type NotificationLinkOrigin = "guess" | "choice";

export interface NotificationCardLinkRecord {
	app: NotificationApp;
	/** Final que o app do banco cita na notificação (4 dígitos). */
	last4: string;
	cardId: string;
	/** `guess`: o app ligou porque o banco só tinha um cartão (só vale enquanto for assim); `choice`: o dono escolheu. */
	origin: NotificationLinkOrigin;
	createdAt: Date;
}

/**
 * Final de cartão que a notificação de um banco cita → cartão do dono. O cartão virtual/online tem final diferente do
 * físico que o Open Finance traz: o dono (ou o app, quando o banco só tem um cartão) liga uma vez e as próximas
 * notificações com esse final já caem no cartão certo. Um cartão por (app, final).
 */
export interface NotificationCardLinkStore {
	get(app: NotificationApp, last4: string): Promise<NotificationCardLinkRecord | null>;
	/** Liga (ou troca o cartão de) este final. `invalid` se o final não tem 4 dígitos; `not_found` se o cartão não existe. */
	set(
		app: NotificationApp,
		last4: string,
		cardId: string,
		origin?: NotificationLinkOrigin,
	): Promise<NotificationCardLinkRecord>;
	/** As ligações (mais antigas primeiro), para o dono ver e esquecer. */
	list(): Promise<NotificationCardLinkRecord[]>;
	/** Esquece a ligação. `false` se não existia. */
	remove(app: NotificationApp, last4: string): Promise<boolean>;
}
