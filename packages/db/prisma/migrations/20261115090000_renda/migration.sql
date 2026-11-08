-- Renda do dono (salário e outras fontes). Só tabela nova: api/worker antigos continuam funcionando durante o deploy.

-- CreateTable
CREATE TABLE "income_sources" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "payday" INTEGER NOT NULL,
    "account_id" TEXT,
    "recurring" BOOLEAN NOT NULL DEFAULT true,
    "month" CHAR(7),
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "income_sources_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "income_sources" ADD CONSTRAINT "income_sources_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Valores: renda positiva, dia de 1 a 31; a recorrente não tem mês e a avulsa precisa de um.
ALTER TABLE "income_sources" ADD CONSTRAINT "income_sources_amount_cents_check" CHECK ("amount_cents" > 0);
ALTER TABLE "income_sources" ADD CONSTRAINT "income_sources_payday_check" CHECK ("payday" BETWEEN 1 AND 31);
ALTER TABLE "income_sources" ADD CONSTRAINT "income_sources_month_check" CHECK (("recurring" AND "month" IS NULL) OR (NOT "recurring" AND "month" IS NOT NULL));
