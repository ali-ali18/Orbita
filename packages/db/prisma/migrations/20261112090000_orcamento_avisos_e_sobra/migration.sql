-- Orçamento: percentual do aviso e destino da sobra do mês (preferências do dono).

-- AlterTable
ALTER TABLE "app_preferences" ADD COLUMN "budget_alert_percent" INTEGER NOT NULL DEFAULT 80,
ADD COLUMN "leftover_account_id" TEXT;

-- AddForeignKey
ALTER TABLE "app_preferences" ADD CONSTRAINT "app_preferences_leftover_account_id_fkey" FOREIGN KEY ("leftover_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Aviso de 1% a 100%.
ALTER TABLE "app_preferences" ADD CONSTRAINT "app_preferences_budget_alert_percent_check" CHECK (
    "budget_alert_percent" BETWEEN 1 AND 100
);
