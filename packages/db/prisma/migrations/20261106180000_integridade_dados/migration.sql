-- Integridade: FKs de conta/cartão sem SET NULL (quebraria os CHECKs), parcela única por grupo e
-- recorrência com exatamente uma conta ou um cartão.

-- DropForeignKey
ALTER TABLE "recurrences" DROP CONSTRAINT "recurrences_account_id_fkey";

-- DropForeignKey
ALTER TABLE "recurrences" DROP CONSTRAINT "recurrences_card_id_fkey";

-- DropForeignKey
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_account_id_fkey";

-- DropForeignKey
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_card_id_fkey";

-- DropForeignKey
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_counterpart_account_id_fkey";

-- CreateIndex
CREATE UNIQUE INDEX "transactions_installment_group_id_installment_number_key" ON "transactions"("installment_group_id", "installment_number");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_counterpart_account_id_fkey" FOREIGN KEY ("counterpart_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurrences" ADD CONSTRAINT "recurrences_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurrences" ADD CONSTRAINT "recurrences_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- CHECK que o Prisma não expressa: a recorrência lança em uma conta OU em um cartão.
ALTER TABLE "recurrences"
    ADD CONSTRAINT "recurrences_account_xor_card_check" CHECK (("account_id" IS NULL) <> ("card_id" IS NULL));
