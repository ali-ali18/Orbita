/** Dinheiro em centavos, sempre inteiro. Nunca `float`. */
export type Cents = number;

/** Data de calendário no fuso do usuário, "YYYY-MM-DD". Não é um instante. */
export type LocalDate = string;

/** Mês de calendário, "YYYY-MM". */
export type MonthKey = string;

/**
 * - `investment`: aplicação (dinheiro que sai da conta para ações, cripto, CDB…). Não é gasto: aparece à parte, como
 *   "Investido". Rendimento e resgate entram como `income`.
 */
export type TransactionKind = "expense" | "income" | "transfer" | "card_payment" | "refund" | "investment";
