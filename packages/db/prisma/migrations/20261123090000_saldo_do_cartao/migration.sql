-- Saldo do cartão que o banco informa (Pluggy `balance` da conta CREDIT): com o disponível, dá o limite efetivo.
ALTER TABLE "cards" ADD COLUMN "balance_cents" INTEGER;
