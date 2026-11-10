-- Contas e cartões do Meu Pluggy passam a saber de qual conexão vieram (sem chave estrangeira: a conexão pode sair
-- e a conta fica, arquivada, com os lançamentos). `archive_reason` marca o arquivamento feito pela saída da conexão,
-- o único que o reconectar desfaz. Os dados já existentes não têm o vínculo (o Pluggy não o guardava): a
-- sincronização completa preenche o vínculo e `unlinked_misses` conta quantas vezes seguidas uma conta sem vínculo não
-- apareceu em nenhuma conexão viva (2 = arquiva).
ALTER TABLE "accounts" ADD COLUMN "connection_id" TEXT, ADD COLUMN "archive_reason" TEXT, ADD COLUMN "unlinked_misses" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "cards" ADD COLUMN "connection_id" TEXT, ADD COLUMN "archive_reason" TEXT, ADD COLUMN "unlinked_misses" INTEGER NOT NULL DEFAULT 0;
