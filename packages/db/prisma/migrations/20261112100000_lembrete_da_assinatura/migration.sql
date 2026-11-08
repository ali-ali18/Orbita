-- "Lembrar 1 dia antes" da assinatura: só a escolha do dono. O aviso começa a valer quando as notificações existirem.

-- AlterTable
ALTER TABLE "recurrences" ADD COLUMN "remind_day_before" BOOLEAN NOT NULL DEFAULT false;
