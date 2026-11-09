-- Dia mais antigo já buscado de cada conexão do Meu Pluggy. Nulo = ainda não buscou os 6 meses de histórico: a próxima
-- sincronização busca desde 183 dias atrás uma vez e registra aqui (a gravação é idempotente, nada duplica).
ALTER TABLE "pluggy_connections" ADD COLUMN "history_from" TEXT;
