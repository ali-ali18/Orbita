/** Notas que o parser e a reconciliação põem nos lançamentos de notificação (texto fixo, também usado para reconhecê-los). */
export const UNCERTAIN_TARGET_NOTE =
	"Pago a um estabelecimento sem dizer se foi no saldo ou no cartão do Mercado Pago. Confira a conta e o cartão para não ficar duplicado.";
export const UNVERIFIED_BANK_NOTE =
	"Lido da notificação de um banco cujo formato ainda não foi conferido. Confira o valor e o estabelecimento.";
/** O final da notificação não é o do cartão (compra online usa o do cartão virtual): lançado no único cartão do banco. */
export const differentFinalNote = (last4: string) =>
	`Final ${last4} diferente do cartão. Único do banco: lancei nele. Confira.`;
