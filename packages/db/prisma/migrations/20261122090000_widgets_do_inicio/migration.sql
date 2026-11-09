-- Layout dos widgets do Início (uma única linha, id "main").

-- CreateTable
CREATE TABLE "home_layout" (
    "id" TEXT NOT NULL DEFAULT 'main',
    "items" JSONB NOT NULL DEFAULT '[]',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "home_layout_pkey" PRIMARY KEY ("id")
);

-- Só a linha "main"; os itens são uma lista.
ALTER TABLE "home_layout" ADD CONSTRAINT "home_layout_single_row_check" CHECK ("id" = 'main');
ALTER TABLE "home_layout" ADD CONSTRAINT "home_layout_items_array_check" CHECK (jsonb_typeof("items") = 'array');
