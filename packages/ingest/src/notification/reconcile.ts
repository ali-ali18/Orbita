import { addDays, type LocalDate } from "@orbita/core";
import type { TransactionStore } from "@orbita/db";

/*
 * Lançamento de notificação que o banco nunca confirma. A notificação entra "aguardando o banco" (confirmado, contando
 * no gasto e na fatura); se o Open Finance nunca trouxer a compra (ela foi cancelada, ou foi num cartão que o Pluggy
 * não lê), ela ficaria somando para sempre. Passados `UNCONFIRMED_AFTER_DAYS` dias, depois de uma sincronização completa
 * daquele cartão/conta, vai para "Para revisar" com uma nota. Nunca apaga: quem decide é o dono.
 * Função pura: o relógio e a hora da sincronização entram por parâmetro.
 */

export const UNCONFIRMED_AFTER_DAYS = 5;
export const UNCONFIRMED_NOTE =
	"O banco não confirmou esta compra. Confira se ela aconteceu: confirme ou apague.";
/** Quanto para trás se procura (notificação mais velha que isto já passou de qualquer revisão útil). */
const LOOKBACK_DAYS = 90;

export async function flagUnconfirmedNotifications(
	transactions: Pick<TransactionStore, "listByTarget" | "update">,
	input: {
		target: { accountId: string } | { cardId: string };
		today: LocalDate;
		/** Início da sincronização completa e bem-sucedida deste cartão/conta. */
		syncedAt: Date;
	},
): Promise<number> {
	const { target, today, syncedAt } = input;
	const oldEnough = syncedAt.getTime() - UNCONFIRMED_AFTER_DAYS * 86_400_000;
	const rows = await transactions.listByTarget(target, { from: addDays(today, -LOOKBACK_DAYS), to: today });
	let flagged = 0;
	for (const t of rows) {
		if (t.source !== "notification" || !t.bankPending || t.editedByOwner || t.note !== null) continue;
		if (t.createdAt.getTime() > oldEnough) continue;
		await transactions.update(t.id, { status: "pending", note: UNCONFIRMED_NOTE });
		flagged++;
	}
	return flagged;
}
