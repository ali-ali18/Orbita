-- Compra da caixa que o banco avisou ter cancelado fica marcada ("cancelled") para o dono dispensar; nunca é lançada.
ALTER TABLE "notification_inbox" DROP CONSTRAINT "notification_inbox_reason_check";
ALTER TABLE "notification_inbox" ADD CONSTRAINT "notification_inbox_reason_check" CHECK ("reason" IN ('format', 'target', 'installment', 'promo', 'cancelled'));
