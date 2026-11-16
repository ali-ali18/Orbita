-- Final de cartão citado nas notificações de um banco (cartão virtual/online) ligado ao cartão do dono. Um por app e final.
CREATE TABLE "notification_card_links" (
    "id" TEXT NOT NULL,
    "app" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "card_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_card_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_card_links_app_last4_key" ON "notification_card_links"("app", "last4");
CREATE INDEX "notification_card_links_card_id_idx" ON "notification_card_links"("card_id");
ALTER TABLE "notification_card_links" ADD CONSTRAINT "notification_card_links_last4_check" CHECK ("last4" ~ '^[0-9]{4}$');
ALTER TABLE "notification_card_links" ADD CONSTRAINT "notification_card_links_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
