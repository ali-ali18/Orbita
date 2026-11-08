-- Aplicações já gravadas como despesa na categoria Investimentos (saída de CONTA, nunca de cartão) viram
-- `investment`. Fica de fora a despesa que tem estorno vivo (o estorno exige uma despesa como original) e a que o dono
-- recategorizou à mão: ali ele disse que é gasto.
UPDATE "transactions" t
SET "kind" = 'investment'
FROM "categories" c
WHERE t."category_id" = c."id"
  AND c."slug" = 'investimentos'
  AND t."kind" = 'expense'
  AND t."account_id" IS NOT NULL
  AND t."card_id" IS NULL
  AND t."deleted_at" IS NULL
  AND t."category_edited_by_owner" = false
  AND NOT EXISTS (
    SELECT 1 FROM "transactions" r WHERE r."refund_of_id" = t."id" AND r."deleted_at" IS NULL
  );
