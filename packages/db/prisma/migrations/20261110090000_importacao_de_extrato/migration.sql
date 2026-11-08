-- Arquivos de extrato já importados: só o hash e os números do resultado (o arquivo nunca é guardado).

-- CreateTable
CREATE TABLE "import_batches" (
    "id" TEXT NOT NULL,
    "file_hash" TEXT NOT NULL,
    "target_key" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_count" INTEGER,
    "duplicate_count" INTEGER,
    "possible_duplicate_count" INTEGER,
    "unrecognized_count" INTEGER,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "import_batches_file_hash_target_key_key" ON "import_batches"("file_hash", "target_key");

-- Hash em hexadecimal de SHA-256 e contagens não negativas.
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_file_hash_check" CHECK ("file_hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_counts_check" CHECK (
    COALESCE("created_count", 0) >= 0 AND COALESCE("duplicate_count", 0) >= 0
    AND COALESCE("possible_duplicate_count", 0) >= 0 AND COALESCE("unrecognized_count", 0) >= 0
);
