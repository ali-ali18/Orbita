-- Contas e cartões do Meu Pluggy passam a saber de qual conexão vieram (sem chave estrangeira: a conexão pode sair
-- e a conta fica, arquivada, com os lançamentos). `archive_reason` marca o arquivamento feito pela saída da conexão,
-- o único que o reconectar desfaz. Os dados já existentes não têm o vínculo (o Pluggy não o guardava): a próxima
-- sincronização completa o preenche e arquiva o que nenhuma conexão viva traz mais.
ALTER TABLE "accounts" ADD COLUMN "connection_id" TEXT, ADD COLUMN "archive_reason" TEXT;
ALTER TABLE "cards" ADD COLUMN "connection_id" TEXT, ADD COLUMN "archive_reason" TEXT;
