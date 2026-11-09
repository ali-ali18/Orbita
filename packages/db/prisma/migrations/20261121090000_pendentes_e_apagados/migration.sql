-- Compras pendentes do cartão, âncoras do banco para lançamentos recriados e rastro do que o banco parou de informar.
-- `bank_pending`: o Pluggy diz PENDING (ainda não efetivou). Não é o `status` de revisão do Órbita.
ALTER TABLE "transactions" ADD COLUMN "bank_pending" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "provider_id" TEXT,
ADD COLUMN "provider_code" TEXT,
ADD COLUMN "last_seen_at" TIMESTAMP(3),
ADD COLUMN "removed_by_bank_at" TIMESTAMP(3);

CREATE INDEX "transactions_provider_id_idx" ON "transactions"("provider_id");
CREATE INDEX "transactions_provider_code_idx" ON "transactions"("provider_code");

-- `connector.isOpenFinance` do item: guardado na conexão para interpretar providerId, operationType e billId.
ALTER TABLE "pluggy_connections" ADD COLUMN "is_open_finance" BOOLEAN;
