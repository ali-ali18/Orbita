-- Perfil, preferências e notificações do dono (uma única linha, id "main").

-- CreateTable
CREATE TABLE "app_preferences" (
    "id" TEXT NOT NULL DEFAULT 'main',
    "display_name" TEXT,
    "default_account_id" TEXT,
    "notification_capture" BOOLEAN NOT NULL DEFAULT false,
    "notification_apps" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notification_to_review" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_preferences_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "app_preferences" ADD CONSTRAINT "app_preferences_default_account_id_fkey" FOREIGN KEY ("default_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Só a linha "main"; nome de 1 a 40 letras quando existe.
ALTER TABLE "app_preferences" ADD CONSTRAINT "app_preferences_single_row_check" CHECK ("id" = 'main');
ALTER TABLE "app_preferences" ADD CONSTRAINT "app_preferences_display_name_check" CHECK (
    "display_name" IS NULL OR char_length("display_name") BETWEEN 1 AND 40
);
