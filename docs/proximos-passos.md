# Próximos passos (guia de implementação)

Onde o projeto está e como continuar, em ordem. Escrito para uma sessão nova (pessoa ou agente) retomar sem contexto da conversa anterior. Leia antes: `AGENTS.md`, `docs/arquitetura.md`, `docs/seguranca.md`.

**Fluxo obrigatório:** código escrito por agentes **Sonnet** (escopo e arquivos claros, sem sobreposição); revisão por um agente **Opus** independente, só leitura, que recebe o pedido e o diff; quem orquestra corrige cada achado, roda `pnpm lint && pnpm typecheck && DATABASE_URL_TEST=... pnpm test`, commita (Conventional Commits em pt-BR) e abre PR. O dono acompanha pelo celular: **sempre mande link** (PR, Actions, commit).

## Status

| Fase                                                                  | Situação       |
| --------------------------------------------------------------------- | -------------- |
| 1. Fundação (monorepo, pareamento, segurança, Docker, CI/CD)          | ✅ PR #1       |
| 2. Engine financeiro (`packages/core`)                                | ✅ PR #16      |
| 3. Dados no banco (modelos + stores)                                  | ✅ PR #17      |
| 4. API das finanças                                                   | ✅ PR #18      |
| 5. App mobile (Expo)                                                  | 🚧 PRs #19–#21 |
| 6. Ingestão (notificação, comprovante, extrato, conciliação, Revisão) | ⏳             |
| 7. Meu Pluggy                                                         | ⏳             |
| 8. Agentes de IA                                                      | ⏳             |
| 9. Metas, assinaturas e demais agentes                                | ⏳             |

## Fase 3 — Dados no banco ✅

Feito no PR #17. Resumo do que a API pode usar (`packages/db`, fábricas `createPrismaStores(db)` / `createMemoryStores()`):

- Stores: `accounts`, `cards` (`getConfig` → formato do `invoiceFor`), `categories` (`ensureDefaults`), `transactions`, `recurrences`, `budgets`, `auth`.
- `transactions`: `create`, `createInstallmentGroup` (única forma de criar parcelas), `upsertByExternal` (idempotente; não ressuscita apagado), `update` (trava a linha; recalcula `budgetMonth` se a data mudar e ele era o padrão; **quem muda a data de compra no cartão manda o `invoiceMonth` novo**, calculado com o engine), `softDelete` (apaga também os estornos e libera o registro da recorrência), `softDeleteGroup`, `get`, `getMany` (compras originais de estornos de outros meses), `listByBudgetMonth`, `listByInvoice`, `listPending({limit})`, `listRecent` (cursor), `listInstallmentGroups`.
- `recurrences.recordPosting` exige lançamento vivo, do mesmo tipo e do mesmo mês.
- Regras: conta, cartão ou categoria arquivados não recebem lançamento novo; recorrência tem conta **ou** cartão; erros são `DataError` (`invalid`, `not_found`, `duplicate`, `bad_reference`) com mensagem em pt-BR — a API deve traduzir para 400/404/409.
- Testes do banco rodam no fuso de São Paulo; concorrência testada no Postgres.

## Fase 4 — API das finanças ✅

Feito no PR #18. O app consome (todas exigem `Authorization: Bearer <token do aparelho>`; erros no formato `{ error: { code, message } }`, mensagem pronta em pt-BR):

- Cadastros: `/v1/accounts`, `/v1/cards`, `/v1/categories`, `/v1/recurrences` (GET lista, GET `/:id`, POST, PATCH `/:id`, DELETE `/:id` arquiva); `/v1/budgets` (GET, PUT `{scope, limitCents}`, DELETE `/:scope`).
- Lançamentos: POST `/v1/transactions` (fatura calculada no servidor), POST `/v1/transactions/installments` (`{cardId, totalCents, count 2..72, date, description, categoryId?}`), PATCH/DELETE `/:id` (`?scope=group` apaga o parcelamento; parcela não muda cartão/data/valor), POST `/:id/confirm`, GET `/v1/transactions?cursor&limit`, `/month/:month`, `/pending?limit` (`{transactions, hasMore}`), `/:id`.
- Tela Início: GET `/v1/summary/:month` → gasto por categoria, orçamentos, `safeToSpend` e `projection` (só mês atual; senão `null`), recorrências pendentes, crédito de estorno.
- Cartão: GET `/v1/cards/:id/invoices/:month` (datas, situação, composição via `invoiceComposition` do engine, lançamentos); GET `/v1/installments?from=YYYY-MM` (pago/falta).
- Recorrência: POST `/v1/recurrences/:id/post` `{month, date?, amountCents?}` (atômico; 409 se já lançada).
- Tipos: o cliente usa `AppType` de `apps/api/src/app.ts` com `hono/client`, e os schemas de `packages/shared` (`finance-api.ts`).
- Regras visíveis ao usuário: datas de 1900 a 2199; receita só em conta (cashback = estorno); status e mês de orçamento nunca vêm do cliente.

## Fase 5 — App mobile (Expo, Android primeiro)

**Etapa 1 pronta (PR #19):** `apps/mobile` com Expo SDK 58 (pnpm sem hoisting), telas **Conectar** e **Início**, sair revogando no servidor, estados de carregando/erro por card, reserva das contas a vencer na barra do orçamento. Prévias em `docs/previews/app/` (geradas com a API real + Playwright no navegador, 390×844). Ainda não testado em Android de verdade.

**APK pronto (PR #20):** `app-android.yml` publica a cada push no `main` (depois do CI) um Release `latest` com `orbita.apk`, assinado com a chave dos segredos `ANDROID_*` (já cadastrados). Link fixo: https://github.com/ali-ali18/Orbita/releases/latest/download/orbita.apk. Detalhes em `docs/app-android.md`.

**Fidelidade ao Figma (PR #21):** ícones exatos em `ui/icons.tsx`, barra de baixo, avatar, medidas; tokens `layout` (barra de status, barra de gestos, alvo de toque). Comparações em `docs/previews/app/figma/`.

**Novo lançamento (PR seguinte ao #21):** rota `novo` (modal) aberta pelo "+" da barra; Saída/Entrada, à vista em conta ou cartão, parcelado 2..72 no cartão; prévia "N× de ~R$ X" (o servidor divide). Ler comprovante, Ditar, Transferir e "+ Nova" categoria aparecem desativados.

**Ordem combinada com o dono (para ele testar com dados reais):** Configurações → **Servidor e chaves** (`44:817`: Client ID/Secret do Pluggy, IDs das conexões, chave da Anthropic; cifrados com `@orbita/security`, a API nunca devolve o valor, só "configurado") → **sincronização do Meu Pluggy** (fase 7) → demais telas.

**Depois:** Atividades (`24:142`) → Cartão (Faturas `33:501`, Parcelas `28:306`, Limites `36:636`) → Assinaturas (`28:450`) → Configurações (`41:605`). Sempre gerar prévias e mandar link.

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
