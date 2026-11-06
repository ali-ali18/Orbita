# Próximos passos (guia de implementação)

Onde o projeto está e como continuar, em ordem. Escrito para uma sessão nova (pessoa ou agente) retomar sem contexto da conversa anterior. Leia antes: `AGENTS.md`, `docs/arquitetura.md`, `docs/seguranca.md`.

**Fluxo obrigatório:** código escrito por agentes **Sonnet** (escopo e arquivos claros, sem sobreposição); revisão por um agente **Opus** independente, só leitura, que recebe o pedido e o diff; quem orquestra corrige cada achado, roda `pnpm lint && pnpm typecheck && DATABASE_URL_TEST=... pnpm test`, commita (Conventional Commits em pt-BR) e abre PR. O dono acompanha pelo celular: **sempre mande link** (PR, Actions, commit).

## Status

| Fase                                                                  | Situação               |
| --------------------------------------------------------------------- | ---------------------- |
| 1. Fundação (monorepo, pareamento, segurança, Docker, CI/CD)          | ✅ PR #1               |
| 2. Engine financeiro (`packages/core`)                                | ✅ PR #16              |
| 3. Dados no banco (modelos + stores)                                  | 🚧 branch `feat/dados` |
| 4. API das finanças                                                   | ⏳                     |
| 5. App mobile (Expo)                                                  | ⏳                     |
| 6. Ingestão (notificação, comprovante, extrato, conciliação, Revisão) | ⏳                     |
| 7. Meu Pluggy                                                         | ⏳                     |
| 8. Agentes de IA                                                      | ⏳                     |
| 9. Metas, assinaturas e demais agentes                                | ⏳                     |

## Fase 3 — Dados no banco (`feat/dados`)

Só `packages/db`, `packages/shared` e o lockfile. Single-user (sem `userId`).

**Modelos Prisma** (migração `dados_financeiros`, colunas em snake_case, ids cuid):

- `Account`: name, kind (`checking|savings|wallet|investment`), bankCode? (ISPB, para o logo), archivedAt, timestamps.
- `Card`: name, bankCode?, last4? (4 dígitos), closingDay e dueDay (1..31), closingRule (`closing_day_next|closing_day_included`, padrão next), limitCents?, archivedAt.
- `Category`: slug único, name, chartSlot? (0..4 = índice de `chart.series`; null = cinza), isSystem, archivedAt. Padrões idempotentes: mercado(0), delivery(1), transporte(2), assinaturas(3), lazer(4), moradia, saude, transferencias (sistema), outros (sistema).
- `Transaction`: kind (`expense|income|transfer|card_payment|refund`), amountCents > 0, date (`@db.Date`), description, categoryId?, accountId?, cardId?, counterpartAccountId? (destino da transferência), refundOfId?, budgetMonth (`YYYY-MM`), invoiceMonth? (só cartão), installmentGroupId?/Number?/Count?, status (`pending|confirmed`), source (`manual|notification|pluggy|receipt|import`), externalId? com único (source, externalId), note?, timestamps, deletedAt (soft delete).
- `Recurrence`: kind (`expense|income`), name, amountCents, dayOfMonth, startDate, endDate?, categoryId?, accountId?, cardId?, archivedAt.
- `RecurrencePosting`: recurrenceId + month únicos, transactionId único. É isso que o engine usa para não contar recorrência duas vezes.
- `Budget`: scope único (`"total"` ou id da categoria), limitCents ≥ 0.
- CHECKs no SQL da migração para o que o Prisma não expressa (valor > 0, dias 1..31, last4, formato de mês).

**Stores** (interface + Prisma + memória + **um** teste de contrato por domínio, como `AuthStore`): `AccountStore`, `CardStore`, `CategoryStore`, `TransactionStore` (criar, grupo de parcelas atômico, `upsertByExternal` idempotente, atualizar, soft delete de item e de grupo, listar por `budgetMonth`, por fatura, pendentes, recentes com cursor), `RecurrenceStore` (+ `recordPosting` único por mês), `BudgetStore`. Fábricas `createPrismaStores(db)` e `createMemoryStores()`.

Invariantes validadas nas duas implementações, com o mesmo erro: despesa/receita/estorno com exatamente uma origem (conta **ou** cartão); cartão exige `invoiceMonth`; transferência exige contas diferentes; pagamento de fatura exige conta e cartão; estorno aponta para despesa existente. Datas voltam idênticas (`2024-02-29`, `2026-12-31`), sem deslocamento de fuso.

Se a sessão anterior deixou o branch incompleto: rode `pnpm typecheck` e os testes, termine o que faltar seguindo esta lista.

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
