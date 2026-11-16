import type { NotificationApp } from "@orbita/shared";

export interface NotificationCancelRecord {
	/** Chave da notificação de cancelamento (a mesma de `notificationKey`): repetir a notificação não cancela de novo. */
	key: string;
	app: NotificationApp;
	last4: string;
	amountCents: number;
	merchant: string | null;
	/** Instante que o Android registrou o cancelamento. */
	postedAt: Date;
	/** Quando serviu para anular uma compra. `null`: ainda espera a compra chegar. */
	consumedAt: Date | null;
	createdAt: Date;
}

export type NotificationCancelInput = Pick<
	NotificationCancelRecord,
	"key" | "app" | "last4" | "amountCents" | "merchant" | "postedAt"
> & { consumed: boolean };

/**
 * Cancelamentos de compra já vistos (sem o texto da notificação: só valor, loja, final e horário). Servem a dois
 * fins: a mesma notificação repetida não cancela uma segunda compra igual, e um cancelamento que chega ANTES da
 * compra espera aqui para anulá-la quando ela chegar.
 */
export interface NotificationCancelStore {
	/** `created: false` se a chave já estava registrada (nada muda). */
	register(input: NotificationCancelInput): Promise<{ created: boolean }>;
	/** Alguma destas chaves já foi registrada? */
	hasAny(keys: readonly string[]): Promise<boolean>;
	/** Os que ainda esperam a compra, do app, com `postedAt >= since`. */
	listPending(app: NotificationApp, since: Date): Promise<NotificationCancelRecord[]>;
	/** Usa o cancelamento: `true` só para quem o usou primeiro. */
	consume(key: string): Promise<boolean>;
	/** Apaga os registrados antes de `before`. Devolve quantos saíram. */
	purgeOlderThan(before: Date): Promise<number>;
}
