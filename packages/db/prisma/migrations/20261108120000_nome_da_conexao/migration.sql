-- Nome da conexão do Meu Pluggy: o dono pode renomear (a sincronização não troca mais) e o resumo de contas/cartões.
-- Compatível nos dois sentidos: colunas novas com default; api/worker antigos continuam funcionando.

-- AlterTable
ALTER TABLE "pluggy_connections" ADD COLUMN     "label_edited_by_owner" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "account_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "card_count" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "pluggy_connections"
    ADD CONSTRAINT "pluggy_connections_counts_check" CHECK ("account_count" >= 0 AND "card_count" >= 0);
