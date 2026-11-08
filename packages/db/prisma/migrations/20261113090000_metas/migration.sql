-- Metas de guardar dinheiro, as contribuições ("Guardar") e o destino da sobra do mês ser uma meta.
-- Só tabelas e coluna nova nula: api/worker antigos continuam funcionando durante o deploy.

-- CreateTable
CREATE TABLE "goals" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "target_cents" INTEGER NOT NULL,
    "deadline" DATE,
    "account_id" TEXT,
    "icon" TEXT NOT NULL DEFAULT 'target',
    "chart_slot" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_contributions" (
    "id" TEXT NOT NULL,
    "goal_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "transaction_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goal_contributions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "goal_contributions_goal_id_date_idx" ON "goal_contributions"("goal_id", "date");

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_contributions" ADD CONSTRAINT "goal_contributions_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_contributions" ADD CONSTRAINT "goal_contributions_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "app_preferences" ADD COLUMN "leftover_goal_id" TEXT;

-- AddForeignKey
ALTER TABLE "app_preferences" ADD CONSTRAINT "app_preferences_leftover_goal_id_fkey" FOREIGN KEY ("leftover_goal_id") REFERENCES "goals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Valores: meta e contribuição positivas; cor no espaço do gráfico (0 a 9). A sobra vai para uma conta OU uma meta.
ALTER TABLE "goals" ADD CONSTRAINT "goals_target_cents_check" CHECK ("target_cents" > 0);
ALTER TABLE "goals" ADD CONSTRAINT "goals_chart_slot_check" CHECK ("chart_slot" BETWEEN 0 AND 9);
ALTER TABLE "goal_contributions" ADD CONSTRAINT "goal_contributions_amount_cents_check" CHECK ("amount_cents" > 0);
ALTER TABLE "app_preferences" ADD CONSTRAINT "app_preferences_leftover_one_target_check" CHECK (
    "leftover_account_id" IS NULL OR "leftover_goal_id" IS NULL
);
