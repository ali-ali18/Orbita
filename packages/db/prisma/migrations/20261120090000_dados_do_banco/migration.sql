-- Números que o banco já entrega (Pluggy): saldo da conta, limite disponível do cartão e as faturas.
ALTER TABLE "accounts" ADD COLUMN "balance_cents" INTEGER,
ADD COLUMN "balance_synced_at" TIMESTAMP(3);

ALTER TABLE "cards" ADD COLUMN "available_cents" INTEGER,
ADD COLUMN "limit_synced_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "card_bills" (
    "id" TEXT NOT NULL,
    "card_id" TEXT NOT NULL,
    "source" "transaction_source" NOT NULL,
    "external_id" TEXT NOT NULL,
    "close_date" DATE,
    "due_date" DATE NOT NULL,
    "total_amount_cents" INTEGER NOT NULL,
    "minimum_payment_cents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "synced_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "card_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card_bill_payments" (
    "id" TEXT NOT NULL,
    "bill_id" TEXT NOT NULL,
    "external_id" TEXT,
    "amount_cents" INTEGER NOT NULL,
    "date" DATE NOT NULL,

    CONSTRAINT "card_bill_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "card_bills_card_id_due_date_idx" ON "card_bills"("card_id", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "card_bills_source_external_id_key" ON "card_bills"("source", "external_id");

-- CreateIndex
CREATE INDEX "card_bill_payments_bill_id_idx" ON "card_bill_payments"("bill_id");

-- AddForeignKey
ALTER TABLE "card_bills" ADD CONSTRAINT "card_bills_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_bill_payments" ADD CONSTRAINT "card_bill_payments_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "card_bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;
