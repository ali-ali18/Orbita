-- Meu Pluggy: contas e cartões ligados ao que veio de fora, e as conexões cadastradas pelo dono.

-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "external_id" TEXT,
ADD COLUMN     "source" "transaction_source" NOT NULL DEFAULT 'manual';

-- AlterTable
ALTER TABLE "cards" ADD COLUMN     "external_id" TEXT,
ADD COLUMN     "source" "transaction_source" NOT NULL DEFAULT 'manual';

-- CreateTable
CREATE TABLE "pluggy_connections" (
    "id" TEXT NOT NULL,
    "label" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_sync_at" TIMESTAMP(3),
    "last_status" TEXT,
    "last_error" TEXT,

    CONSTRAINT "pluggy_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_source_external_id_key" ON "accounts"("source", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "cards_source_external_id_key" ON "cards"("source", "external_id");

-- CHECKs que o Prisma não expressa.
ALTER TABLE "accounts"
    ADD CONSTRAINT "accounts_external_id_check" CHECK ("external_id" IS NULL OR char_length("external_id") BETWEEN 1 AND 200);

ALTER TABLE "cards"
    ADD CONSTRAINT "cards_external_id_check" CHECK ("external_id" IS NULL OR char_length("external_id") BETWEEN 1 AND 200);

ALTER TABLE "pluggy_connections"
    ADD CONSTRAINT "pluggy_connections_id_check" CHECK ("id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
    ADD CONSTRAINT "pluggy_connections_label_check" CHECK ("label" IS NULL OR char_length("label") BETWEEN 1 AND 60),
    ADD CONSTRAINT "pluggy_connections_last_status_check" CHECK ("last_status" IS NULL OR "last_status" IN ('ok', 'partial', 'error', 'no_keys')),
    ADD CONSTRAINT "pluggy_connections_last_error_check" CHECK ("last_error" IS NULL OR char_length("last_error") <= 500);
