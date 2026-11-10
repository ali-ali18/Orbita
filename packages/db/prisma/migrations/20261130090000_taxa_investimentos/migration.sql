-- Taxa e valor aplicado informados pelo dono, e a série diária do CDI. Só tabelas novas: api/worker antigos seguem funcionando.
-- CreateTable
CREATE TABLE "investment_terms" (
    "investment_id" TEXT NOT NULL,
    "rate_kind" TEXT,
    "rate_bps" INTEGER,
    "rate_source" TEXT,
    "invested_cents" INTEGER,
    "invested_source" TEXT,
    "start_date" DATE,
    "start_date_source" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "investment_terms_pkey" PRIMARY KEY ("investment_id")
);

-- CreateTable
CREATE TABLE "cdi_rates" (
    "day" DATE NOT NULL,
    "rate_e8" INTEGER NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cdi_rates_pkey" PRIMARY KEY ("day")
);

-- AddForeignKey
ALTER TABLE "investment_terms" ADD CONSTRAINT "investment_terms_investment_id_fkey" FOREIGN KEY ("investment_id") REFERENCES "investments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
