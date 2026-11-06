import { defineConfig } from "prisma/config";

export default defineConfig({
	schema: "prisma/schema.prisma",
	migrations: { path: "prisma/migrations" },
	// `prisma generate` não precisa de banco; migrate precisa do DATABASE_URL real.
	datasource: { url: process.env.DATABASE_URL ?? "postgresql://localhost:5432/orbita" },
});
