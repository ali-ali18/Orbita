-- Investimentos: posição atual, retrato diário e movimentações. Só tabelas novas: api/worker antigos seguem funcionando.
-- CreateTable
CREATE TABLE "investments" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "connection_id" TEXT,
    "type" TEXT,
    "subtype" TEXT,
    "name" TEXT,
    "code" TEXT,
    "isin" TEXT,
    "currency" TEXT,
    "status" TEXT,
    "balance_cents" INTEGER,
    "gross_cents" INTEGER,
    "invested_cents" INTEGER,
    "profit_cents" INTEGER,
    "withdrawable_cents" INTEGER,
    "income_tax_cents" INTEGER,
    "financial_tax_cents" INTEGER,
    "quantity" DECIMAL(28,8),
    "unit_value" DECIMAL(28,8),
    "rate" DECIMAL(28,8),
    "rate_type" TEXT,
    "fixed_annual_rate" DECIMAL(28,8),
    "annual_rate" DECIMAL(28,8),
    "last_month_rate" DECIMAL(28,8),
    "last_twelve_months_rate" DECIMAL(28,8),
    "position_date" DATE,
    "due_date" DATE,
    "issue_date" DATE,
    "purchase_date" DATE,
    "issuer" TEXT,
    "synced_at" TIMESTAMP(3) NOT NULL,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "investments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment_snapshots" (
    "id" TEXT NOT NULL,
    "investment_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "balance_cents" INTEGER NOT NULL,
    "gross_cents" INTEGER,
    "invested_cents" INTEGER,
    "quantity" DECIMAL(28,8),
    "unit_value" DECIMAL(28,8),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investment_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment_transactions" (
    "id" TEXT NOT NULL,
    "investment_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "type" TEXT,
    "movement_type" TEXT,
    "date" DATE,
    "trade_date" DATE,
    "amount_cents" INTEGER,
    "net_amount_cents" INTEGER,
    "quantity" DECIMAL(28,8),
    "unit_value" DECIMAL(28,8),
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "investment_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "investments_connection_id_idx" ON "investments"("connection_id");

-- CreateIndex
CREATE UNIQUE INDEX "investments_source_external_id_key" ON "investments"("source", "external_id");

-- CreateIndex
CREATE INDEX "investment_snapshots_day_idx" ON "investment_snapshots"("day");

-- CreateIndex
CREATE UNIQUE INDEX "investment_snapshots_investment_id_day_key" ON "investment_snapshots"("investment_id", "day");

-- CreateIndex
CREATE INDEX "investment_transactions_investment_id_date_idx" ON "investment_transactions"("investment_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "investment_transactions_source_external_id_key" ON "investment_transactions"("source", "external_id");

-- AddForeignKey
ALTER TABLE "investment_snapshots" ADD CONSTRAINT "investment_snapshots_investment_id_fkey" FOREIGN KEY ("investment_id") REFERENCES "investments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_transactions" ADD CONSTRAINT "investment_transactions_investment_id_fkey" FOREIGN KEY ("investment_id") REFERENCES "investments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

