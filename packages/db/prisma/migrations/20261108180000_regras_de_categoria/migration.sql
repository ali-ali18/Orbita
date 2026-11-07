-- Categoria do banco guardada no lançamento, nome do estabelecimento, marca "categoria editada pelo dono" e
-- regras de categoria aprendidas. Compatível nos dois sentidos: colunas novas nulas/com default e tabela nova;
-- api/worker antigos continuam funcionando durante o deploy.

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "source_category" TEXT,
ADD COLUMN     "merchant_name" TEXT,
ADD COLUMN     "category_edited_by_owner" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "transactions"
    ADD CONSTRAINT "transactions_source_category_len_check" CHECK ("source_category" IS NULL OR char_length("source_category") BETWEEN 1 AND 120),
    ADD CONSTRAINT "transactions_merchant_name_len_check" CHECK ("merchant_name" IS NULL OR char_length("merchant_name") BETWEEN 1 AND 120);

-- CreateTable
CREATE TABLE "category_rules" (
    "id" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "category_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "category_rules_pattern_key" ON "category_rules"("pattern");

-- CreateIndex
CREATE INDEX "category_rules_category_id_idx" ON "category_rules"("category_id");

-- AddForeignKey
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "category_rules"
    ADD CONSTRAINT "category_rules_pattern_len_check" CHECK (char_length("pattern") BETWEEN 3 AND 60);
