-- Registro de atividades do agente Economia: o que ele fez sozinho, com motivo, evidência e o que o Desfazer precisa.

-- CreateTable
CREATE TABLE "agent_activities" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "undo" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'done',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undone_at" TIMESTAMP(3),
    "undo_note" TEXT,

    CONSTRAINT "agent_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_activities_created_at_idx" ON "agent_activities"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "agent_activities_agent_id_dedupe_key_key" ON "agent_activities"("agent_id", "dedupe_key");

-- AddForeignKey
ALTER TABLE "agent_activities" ADD CONSTRAINT "agent_activities_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
