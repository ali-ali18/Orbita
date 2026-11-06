-- CreateEnum
CREATE TYPE "account_kind" AS ENUM ('checking', 'savings', 'wallet', 'investment');

-- CreateEnum
CREATE TYPE "closing_rule" AS ENUM ('closing_day_next', 'closing_day_included');

-- CreateEnum
CREATE TYPE "transaction_kind" AS ENUM ('expense', 'income', 'transfer', 'card_payment', 'refund');

-- CreateEnum
CREATE TYPE "transaction_status" AS ENUM ('pending', 'confirmed');

-- CreateEnum
CREATE TYPE "transaction_source" AS ENUM ('manual', 'notification', 'pluggy', 'receipt', 'import');

-- CreateEnum
CREATE TYPE "recurrence_kind" AS ENUM ('expense', 'income');

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "account_kind" NOT NULL,
    "bank_code" TEXT,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cards" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bank_code" TEXT,
    "last4" TEXT,
    "closing_day" INTEGER NOT NULL,
    "due_day" INTEGER NOT NULL,
    "closing_rule" "closing_rule" NOT NULL DEFAULT 'closing_day_next',
    "limit_cents" INTEGER,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "chart_slot" INTEGER,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "kind" "transaction_kind" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "category_id" TEXT,
    "account_id" TEXT,
    "card_id" TEXT,
    "counterpart_account_id" TEXT,
    "refund_of_id" TEXT,
    "budget_month" CHAR(7) NOT NULL,
    "invoice_month" CHAR(7),
    "installment_group_id" TEXT,
    "installment_number" INTEGER,
    "installment_count" INTEGER,
    "status" "transaction_status" NOT NULL DEFAULT 'confirmed',
    "source" "transaction_source" NOT NULL DEFAULT 'manual',
    "external_id" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurrences" (
    "id" TEXT NOT NULL,
    "kind" "recurrence_kind" NOT NULL,
    "name" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "day_of_month" INTEGER NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "category_id" TEXT,
    "account_id" TEXT,
    "card_id" TEXT,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurrences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurrence_postings" (
    "id" TEXT NOT NULL,
    "recurrence_id" TEXT NOT NULL,
    "month" CHAR(7) NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recurrence_postings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budgets" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "limit_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "transactions_budget_month_idx" ON "transactions"("budget_month");

-- CreateIndex
CREATE INDEX "transactions_card_id_invoice_month_idx" ON "transactions"("card_id", "invoice_month");

-- CreateIndex
CREATE INDEX "transactions_date_idx" ON "transactions"("date");

-- CreateIndex
CREATE INDEX "transactions_status_idx" ON "transactions"("status");

-- CreateIndex
CREATE INDEX "transactions_installment_group_id_idx" ON "transactions"("installment_group_id");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_source_external_id_key" ON "transactions"("source", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "recurrence_postings_transaction_id_key" ON "recurrence_postings"("transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "recurrence_postings_recurrence_id_month_key" ON "recurrence_postings"("recurrence_id", "month");

-- CreateIndex
CREATE UNIQUE INDEX "budgets_scope_key" ON "budgets"("scope");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_counterpart_account_id_fkey" FOREIGN KEY ("counterpart_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_refund_of_id_fkey" FOREIGN KEY ("refund_of_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurrences" ADD CONSTRAINT "recurrences_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurrences" ADD CONSTRAINT "recurrences_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurrences" ADD CONSTRAINT "recurrences_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurrence_postings" ADD CONSTRAINT "recurrence_postings_recurrence_id_fkey" FOREIGN KEY ("recurrence_id") REFERENCES "recurrences"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurrence_postings" ADD CONSTRAINT "recurrence_postings_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECKs que o Prisma não expressa. Espelham as regras de @orbita/shared (transaction-rules.ts).
ALTER TABLE "cards"
    ADD CONSTRAINT "cards_closing_day_check" CHECK ("closing_day" BETWEEN 1 AND 31),
    ADD CONSTRAINT "cards_due_day_check" CHECK ("due_day" BETWEEN 1 AND 31),
    ADD CONSTRAINT "cards_last4_check" CHECK ("last4" IS NULL OR "last4" ~ '^[0-9]{4}$'),
    ADD CONSTRAINT "cards_limit_cents_check" CHECK ("limit_cents" IS NULL OR "limit_cents" >= 0);

ALTER TABLE "categories"
    ADD CONSTRAINT "categories_chart_slot_check" CHECK ("chart_slot" IS NULL OR "chart_slot" BETWEEN 0 AND 4);

ALTER TABLE "transactions"
    ADD CONSTRAINT "transactions_amount_cents_check" CHECK ("amount_cents" > 0),
    ADD CONSTRAINT "transactions_budget_month_check" CHECK ("budget_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    ADD CONSTRAINT "transactions_invoice_month_check" CHECK ("invoice_month" IS NULL OR "invoice_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    -- Mês da fatura só em compra/estorno no cartão (pagamento de fatura não tem).
    ADD CONSTRAINT "transactions_invoice_month_card_check" CHECK (
        ("invoice_month" IS NOT NULL) = ("card_id" IS NOT NULL AND "kind" <> 'card_payment')
    ),
    -- Parcelamento: grupo, número e total juntos; número de 1 ao total; no máximo 72x.
    ADD CONSTRAINT "transactions_installment_check" CHECK (
        ("installment_group_id" IS NULL AND "installment_number" IS NULL AND "installment_count" IS NULL)
        OR ("installment_group_id" IS NOT NULL AND "installment_number" IS NOT NULL AND "installment_count" IS NOT NULL
            AND "installment_count" BETWEEN 1 AND 72
            AND "installment_number" BETWEEN 1 AND "installment_count")
    );

ALTER TABLE "recurrences"
    ADD CONSTRAINT "recurrences_amount_cents_check" CHECK ("amount_cents" > 0),
    ADD CONSTRAINT "recurrences_day_of_month_check" CHECK ("day_of_month" BETWEEN 1 AND 31),
    ADD CONSTRAINT "recurrences_end_date_check" CHECK ("end_date" IS NULL OR "end_date" >= "start_date");

ALTER TABLE "recurrence_postings"
    ADD CONSTRAINT "recurrence_postings_month_check" CHECK ("month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

ALTER TABLE "budgets"
    ADD CONSTRAINT "budgets_limit_cents_check" CHECK ("limit_cents" >= 0);
