-- Cancelamento de compra já visto numa notificação de banco (só valor, loja, final e horário; sem o texto).
CREATE TABLE "notification_cancellations" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "app" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "merchant" TEXT,
    "posted_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_cancellations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_cancellations_key_key" ON "notification_cancellations"("key");
CREATE INDEX "notification_cancellations_app_consumed_at_posted_at_idx" ON "notification_cancellations"("app", "consumed_at", "posted_at");
CREATE INDEX "notification_cancellations_created_at_idx" ON "notification_cancellations"("created_at");
ALTER TABLE "notification_cancellations" ADD CONSTRAINT "notification_cancellations_amount_check" CHECK ("amount_cents" > 0);
