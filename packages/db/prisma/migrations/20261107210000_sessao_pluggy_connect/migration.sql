-- Conectar banco pelo Pluggy Connect: sessão de uso único entre o app e a página web do servidor.

-- CreateTable
CREATE TABLE "pluggy_connect_sessions" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pluggy_connect_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pluggy_connect_sessions_token_hash_key" ON "pluggy_connect_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "pluggy_connect_sessions_used_at_expires_at_idx" ON "pluggy_connect_sessions"("used_at", "expires_at");
