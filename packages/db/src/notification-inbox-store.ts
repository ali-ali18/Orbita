import type { NotificationApp, NotificationInboxReason } from "@orbita/shared";

/** Quantas notificações a lista guarda; ao passar, as mais antigas saem. */
export const NOTIFICATION_INBOX_LIMIT = 100;

export interface NotificationInboxRecord {
	id: string;
	/** Hash de pacote + texto + minuto: o mesmo `externalId` que o lançamento teria. */
	key: string;
	app: NotificationApp;
	title: string;
	text: string;
	reason: NotificationInboxReason;
	/** Instante que o Android registrou a notificação. */
	postedAt: Date;
	createdAt: Date;
}

export type NotificationInboxInput = Pick<
	NotificationInboxRecord,
	"key" | "app" | "title" | "text" | "reason" | "postedAt"
>;

/**
 * Notificações de banco que não viraram lançamento (formato desconhecido, ou cartão/conta não achado). É o único lugar
 * em que o texto de uma notificação fica no servidor, e só até o dono resolver (ou até passar de
 * `NOTIFICATION_INBOX_LIMIT`). Idempotente por `key`.
 */
export interface NotificationInboxStore {
	/** `created: false` se a mesma `key` já estava na lista (o motivo e o texto dela não mudam). */
	add(input: NotificationInboxInput): Promise<{ created: boolean }>;
	/** Mais novas primeiro. */
	list(limit?: number): Promise<NotificationInboxRecord[]>;
	count(): Promise<number>;
	/** `false` se não existe. */
	remove(id: string): Promise<boolean>;
	/** Apaga as guardadas antes de `before` (prazo da lista). Devolve quantas saíram. */
	purgeOlderThan(before: Date): Promise<number>;
}
