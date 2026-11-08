-- Modelo do chat escolhido no app (nulo = padrão do servidor). Só colunas novas e opcionais: api/worker antigos seguem funcionando.
ALTER TABLE "ai_settings" ADD COLUMN "chat_model" TEXT,
ADD COLUMN "chat_model_fast" TEXT;
