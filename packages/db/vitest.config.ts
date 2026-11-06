import { defineConfig } from "vitest/config";

// Os testes de contrato compartilham o mesmo banco (DATABASE_URL_TEST) e limpam as tabelas a cada teste.
export default defineConfig({ test: { fileParallelism: false } });
