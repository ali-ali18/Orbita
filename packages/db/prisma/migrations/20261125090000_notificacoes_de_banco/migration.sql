-- Leitura de notificações de banco: o parser entendeu e o dono quer confirmar antes (padrão: entra direto, "aguardando o banco").
ALTER TABLE "app_preferences" ADD COLUMN "notification_ask_first" BOOLEAN NOT NULL DEFAULT false;

-- Notificação que não virou lançamento (formato desconhecido ou cartão/conta não achado). Só esta guarda o texto.
CREATE TABLE "notification_inbox" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "app" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "posted_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_inbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_inbox_key_key" ON "notification_inbox"("key");
CREATE INDEX "notification_inbox_created_at_idx" ON "notification_inbox"("created_at");
ALTER TABLE "notification_inbox" ADD CONSTRAINT "notification_inbox_reason_check" CHECK ("reason" IN ('format', 'target'));
