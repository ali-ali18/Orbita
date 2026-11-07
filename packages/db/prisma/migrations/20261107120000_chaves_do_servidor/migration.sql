-- Chaves de API e credenciais do servidor, sempre cifradas (AES-GCM, AAD = nome da chave).

-- CreateTable
CREATE TABLE "server_secrets" (
    "name" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "server_secrets_pkey" PRIMARY KEY ("name")
);
