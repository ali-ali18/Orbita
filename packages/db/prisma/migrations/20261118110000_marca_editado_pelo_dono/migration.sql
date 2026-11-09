-- Marca geral "o dono mexeu": a sincronização e o pareamento deixam de reescrever tipo, data, valor, conta ou cartão
-- do que o dono corrigiu à mão. Antes só a troca de categoria deixava marca (`category_edited_by_owner`).
ALTER TABLE "transactions" ADD COLUMN "edited_by_owner" BOOLEAN NOT NULL DEFAULT false;

-- Quem já tinha a categoria trocada à mão também mexeu no lançamento: herda a marca (o dado de edições de tipo/data
-- anteriores a esta versão não existe, então não há como recuperá-las).
UPDATE "transactions" SET "edited_by_owner" = true WHERE "category_edited_by_owner" = true;
