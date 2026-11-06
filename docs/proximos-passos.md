# Próximos passos (guia de implementação)

Onde o projeto está e como continuar, em ordem. Escrito para uma sessão nova (pessoa ou agente) retomar sem contexto da conversa anterior. Leia antes: `AGENTS.md`, `docs/arquitetura.md`, `docs/seguranca.md`.

**Fluxo obrigatório:** código escrito por agentes **Sonnet** (escopo e arquivos claros, sem sobreposição); revisão por um agente **Opus** independente, só leitura, que recebe o pedido e o diff; quem orquestra corrige cada achado, roda `pnpm lint && pnpm typecheck && DATABASE_URL_TEST=... pnpm test`, commita (Conventional Commits em pt-BR) e abre PR. O dono acompanha pelo celular: **sempre mande link** (PR, Actions, commit).

## Status

| Fase                                                                  | Situação               |
| --------------------------------------------------------------------- | ---------------------- |
| 1. Fundação (monorepo, pareamento, segurança, Docker, CI/CD)          | ✅ PR #1               |
| 2. Engine financeiro (`packages/core`)                                | ✅ PR #16              |
| 3. Dados no banco (modelos + stores)                                  | ✅ PR #17              |
| 4. API das finanças                                                   | 🚧 `feat/api-financas` |
| 5. App mobile (Expo)                                                  | ⏳                     |
| 6. Ingestão (notificação, comprovante, extrato, conciliação, Revisão) | ⏳                     |
| 7. Meu Pluggy                                                         | ⏳                     |
| 8. Agentes de IA                                                      | ⏳                     |
| 9. Metas, assinaturas e demais agentes                                | ⏳                     |

## Fase 3 — Dados no banco ✅

Feito no PR #17. Resumo do que a API pode usar (`packages/db`, fábricas `createPrismaStores(db)` / `createMemoryStores()`):

- Stores: `accounts`, `cards` (`getConfig` → formato do `invoiceFor`), `categories` (`ensureDefaults`), `transactions`, `recurrences`, `budgets`, `auth`.
- `transactions`: `create`, `createInstallmentGroup` (única forma de criar parcelas), `upsertByExternal` (idempotente; não ressuscita apagado), `update` (trava a linha; recalcula `budgetMonth` se a data mudar e ele era o padrão; **quem muda a data de compra no cartão manda o `invoiceMonth` novo**, calculado com o engine), `softDelete` (apaga também os estornos e libera o registro da recorrência), `softDeleteGroup`, `get`, `getMany` (compras originais de estornos de outros meses), `listByBudgetMonth`, `listByInvoice`, `listPending({limit})`, `listRecent` (cursor), `listInstallmentGroups`.
- `recurrences.recordPosting` exige lançamento vivo, do mesmo tipo e do mesmo mês.
- Regras: conta, cartão ou categoria arquivados não recebem lançamento novo; recorrência tem conta **ou** cartão; erros são `DataError` (`invalid`, `not_found`, `duplicate`, `bad_reference`) com mensagem em pt-BR — a API deve traduzir para 400/404/409.
- Testes do banco rodam no fuso de São Paulo; concorrência testada no Postgres.

## Fase 4 — API das finanças

Um módulo por assunto em `apps/api/src/modules/` (todas as rotas exigem aparelho pareado; corpo validado com os schemas de `packages/shared`):

- `accounts`, `cards`, `categories`, `budgets`, `recurrences`: CRUD.
- `transactions`: criar (à vista ou parcelado: usar `installmentSchedule` do engine para gerar o grupo com `invoiceMonth` e `budgetMonth` de cada parcela), editar, apagar (parcelado apaga o grupo), listar recentes e por mês, confirmar pendente.
- `summary`: para a tela Início, sempre calculado pelo engine:
  - `GET /v1/summary/month?month=YYYY-MM` → `summarizeMonth`, orçamento por categoria (`budgetStatus`), `safeToSpend` (com recorrências pendentes via `pendingInMonth` + postings) e `projectMonth`.
  - `GET /v1/cards/:id/invoices/:month` → fatura (datas, status, composição: compras, assinaturas, parcelas, estornos) e lançamentos.
  - `GET /v1/installments?from=YYYY-MM` → grupos ativos com pago/falta (`remainingInstallments`).
- `recurrences/:id/post` → cria o lançamento do mês e registra o posting.
- Testes: rotas com stores em memória; um teste de "dá pra gastar" ponta a ponta com aluguel já lançado (não pode contar duas vezes).

## Fase 5 — App mobile (Expo, Android primeiro)

- `apps/mobile` com Expo Router, TanStack Query e cliente tipado do Hono (`hono/client` com o `AppType` da API).
- Camadas: `ui/` (primitivos só com tokens de `@orbita/tokens`), `features/` (por assunto), `app/` (telas). Ver `docs/styleguide.md`.
- Ordem das telas (Figma: https://www.figma.com/design/QLtix4jvalHCosZrhuKFtW): pareamento (endereço + código; token no `expo-secure-store`; biometria) → Início → Atividades → Novo lançamento → Cartão (Faturas, Parcelas, Limites) → Assinaturas → Configurações.
- Fonte Geist; logos dos bancos via `logos-bancos-br`; avatares dos agentes (SVG gerado pelo motor do projeto Atlas).
- Build do APK no GitHub Actions (`expo prebuild` + Gradle), artefato baixável; nada de EAS.

## Fase 6 — Ingestão e Revisão

- `packages/ingest`: evento bruto com chave de idempotência → normalizador → conciliador (mesmo valor, mesma conta, data próxima, nome parecido) → lançamento `pending` ou junta com existente → dúvida vai para **Para revisar**.
- Notificações Android (`NotificationListenerService`, exige dev build): parser por banco com regras; IA só quando o parser não reconhece, numa chamada **sem ferramentas**.
- Comprovante (imagem/PDF compartilhado) e extrato (CSV, OFX, PDF de fatura) com tela de revisão.
- Categorização por regras aprendidas com as correções do usuário.

## Fase 7 — Meu Pluggy

Worker sincroniza 1x/dia (contas, cartões, faturas, lançamentos) usando `upsertByExternal(source "pluggy", id do Pluggy)`; Pluggy confirma o que a notificação criou como `pending`. Credenciais guardadas com o cofre AES-GCM de `@orbita/security` (AAD por campo). O plano pessoal não lista conexões pela API: o ID de cada conexão é cadastrado uma vez.

## Fase 8 — Agentes de IA

SDK da Anthropic (Tool Runner), modelo barato por padrão, limite mensal de gasto visível. Ferramentas de leitura (resumo, fatura, lançamentos) e de escrita (lançar, recategorizar, criar meta/alerta) que chamam os módulos da API; toda escrita gera card com Desfazer. Avisos decididos pelo worker (determinístico); a IA só redige. Agentes: Órbita (principal), Vigia, Fechamento, Metas, Caça-assinatura, Cofrinho.

## Pendências conhecidas

- Dependabot npm falhou na primeira execução (provavelmente pnpm 10 / workspace): investigar.
- Vencimento em fim de semana/feriado não é empurrado para dia útil (documentado no engine).
- Limite de requisições em memória (uma instância da API).
