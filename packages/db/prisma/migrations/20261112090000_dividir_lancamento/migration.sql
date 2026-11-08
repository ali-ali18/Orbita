-- Dividir um lançamento em partes com categorias diferentes: as partes dividem um id de grupo.
-- Compatível nos dois sentidos: coluna nova nula e índice; api/worker antigos continuam funcionando durante o deploy.

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "split_group_id" TEXT;

-- CreateIndex
CREATE INDEX "transactions_split_group_id_idx" ON "transactions"("split_group_id");
