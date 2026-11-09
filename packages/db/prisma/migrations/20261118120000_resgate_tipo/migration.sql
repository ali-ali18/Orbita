-- Resgate de investimento: o principal que volta para a conta. Nao e renda nem gasto; abate o "Investido".
ALTER TYPE "transaction_kind" ADD VALUE IF NOT EXISTS 'redemption';
