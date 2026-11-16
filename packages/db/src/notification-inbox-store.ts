import type { NotificationApp, NotificationInboxReason } from "@orbita/shared";

/** Quantas notificações a lista guarda; ao passar, as mais antigas saem. */
export const NOTIFICATION_INBOX_LIMIT = 100;
/**
 * Quantas ofertas ocultas (`reason` "promo") a caixa guarda, à parte das falhas: ao estourar sai só a mais antiga, e uma
 * enxurrada de propaganda nunca expulsa falha de verdade. Ofertas e falhas têm a mesma retenção por idade (30 dias).
 */
export const NOTIFICATION_PROMO_LIMIT = 100;

export interface NotificationInboxRecord {
	id: string;
	/** Hash de pacote + texto + minuto: o mesmo `externalId` que o lançamento teria. */
	key: string;
	app: NotificationApp;
	title: string;
	text: string;
	reason: NotificationInboxReason;
	/** O dono disse "é compra" a uma oferta oculta: não se oculta de novo. */
	ownerKept: boolean;
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
	/** Mais novas primeiro. Sem `limit`, devolve TODAS (falhas até `NOTIFICATION_INBOX_LIMIT` e ofertas até `NOTIFICATION_PROMO_LIMIT`: os limites são separados). */
	list(limit?: number): Promise<NotificationInboxRecord[]>;
	/** Quantas esperam o dono ("Não consegui lançar"): NÃO conta as ofertas ocultas. */
	count(): Promise<number>;
	/** Quantas ofertas ocultas. */
	countHidden(): Promise<number>;
	/** Muda o motivo da que tem esta chave (o classificador mudou de ideia). Sem efeito se não existe. */
	setReason(key: string, reason: NotificationInboxReason): Promise<void>;
	/** "É compra": a oferta oculta volta à lista como "format" e não é ocultada de novo. `false` se não existe ou não era oculta. */
	keepAsPurchase(id: string): Promise<boolean>;
	/** `false` se não existe. */
	remove(id: string): Promise<boolean>;
	/** Apaga as guardadas antes de `before` (prazo da lista). Devolve quantas saíram. */
	purgeOlderThan(before: Date): Promise<number>;
}
