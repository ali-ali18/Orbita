-- De onde vem a regra de fechamento do cartão: "default", "inferred" (deduzida pelo sync) ou "owner" (escolha do dono).
ALTER TABLE "cards" ADD COLUMN "closing_rule_source" TEXT NOT NULL DEFAULT 'default';
-- Cartão do banco já na regra "incluído" só chegou lá pela dedução do sync (o app não oferece outra via a ele): marca como
-- deduzida, para o sync poder desfazer se a evidência mudar. Os demais ficam no padrão.
UPDATE "cards" SET "closing_rule_source" = 'inferred' WHERE "source" <> 'manual' AND "closing_rule" = 'closing_day_included';
