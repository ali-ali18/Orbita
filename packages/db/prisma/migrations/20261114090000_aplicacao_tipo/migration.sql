-- Aplicação em investimento deixa de ser "gasto": ganha tipo próprio. Só acrescenta um valor ao enum
-- (api/worker antigos continuam funcionando; eles só não conhecem o valor novo).
ALTER TYPE "transaction_kind" ADD VALUE IF NOT EXISTS 'investment';
