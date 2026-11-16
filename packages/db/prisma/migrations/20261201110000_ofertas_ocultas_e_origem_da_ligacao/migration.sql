-- Oferta classificada pelo app fica guardada na caixa, oculta da lista principal (motivo "promo"); "é compra" a devolve e fixa.
-- Aviso de compra cancelada do banco é um item da caixa com motivo "cancelled" (só o aviso; nada mais muda).
ALTER TABLE "notification_inbox" DROP CONSTRAINT "notification_inbox_reason_check";
ALTER TABLE "notification_inbox" ADD CONSTRAINT "notification_inbox_reason_check" CHECK ("reason" IN ('format', 'target', 'installment', 'promo', 'cancelled'));
ALTER TABLE "notification_inbox" ADD COLUMN "owner_kept" BOOLEAN NOT NULL DEFAULT false;

-- Ligação de final feita por palpite (único cartão do banco) ou por escolha do dono.
ALTER TABLE "notification_card_links" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'choice';
ALTER TABLE "notification_card_links" ADD CONSTRAINT "notification_card_links_origin_check" CHECK ("origin" IN ('guess', 'choice'));
