-- Reconexão em modo de atualização do Pluggy Connect: a sessão guarda o item existente que o widget vai atualizar.
ALTER TABLE "pluggy_connect_sessions" ADD COLUMN "update_item_id" TEXT;
