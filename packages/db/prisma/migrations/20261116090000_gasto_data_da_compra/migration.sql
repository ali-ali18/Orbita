-- O Gasto pesa pela data da compra. Compras de cartão vindas do Pluggy gravadas enquanto o gasto seguia a fatura podem
-- ter `budget_month` torto: volta para o mês da compra (à vista) ou mês da compra + n − 1 (parcela n; a parcela do
-- Pluggy leva a data da compra). Idempotente (só mexe no que difere) e deixa de fora o que o dono editou.
UPDATE "transactions" t
SET "budget_month" = to_char(
  t."date" + (COALESCE(t."installment_number", 1) - 1) * interval '1 month',
  'YYYY-MM'
)
WHERE t."source" = 'pluggy'
  AND t."card_id" IS NOT NULL
  AND t."kind" IN ('expense', 'refund')
  AND t."deleted_at" IS NULL
  AND t."category_edited_by_owner" = false
  AND t."budget_month" IS DISTINCT FROM to_char(
    t."date" + (COALESCE(t."installment_number", 1) - 1) * interval '1 month',
    'YYYY-MM'
  );
