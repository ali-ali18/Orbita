import { defineConfig } from "vitest/config";

// - Os testes de contrato compartilham o mesmo banco (DATABASE_URL_TEST) e limpam as tabelas a cada teste.
// - Sempre num fuso diferente de UTC: se uma data andar por causa do fuso, o teste pega (ver local-date.test.ts).
export default defineConfig({ test: { fileParallelism: false, env: { TZ: "America/Sao_Paulo" } } });
