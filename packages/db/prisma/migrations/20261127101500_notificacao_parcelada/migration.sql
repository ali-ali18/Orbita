-- Motivo novo da lista "Não entendi": compra parcelada (o valor do texto nem sempre é o da parcela).
ALTER TABLE "notification_inbox" DROP CONSTRAINT "notification_inbox_reason_check";
ALTER TABLE "notification_inbox" ADD CONSTRAINT "notification_inbox_reason_check" CHECK ("reason" IN ('format', 'target', 'installment'));
