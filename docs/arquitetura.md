# Arquitetura

O objetivo é um código **fácil de mexer**: achar onde fica cada coisa, mudar uma parte sem quebrar outra, e acrescentar uma feature sem cerimônia. Poucas regras, todas com motivo.

## O mapa

```
apps/
  api/        Hono. Entrada HTTP: valida, chama o módulo, responde.
  worker/     BullMQ. Tarefas agendadas e em segundo plano.
  mobile/     Expo (próxima fase).
packages/
  shared/     Schemas Zod e tipos que o app e a API compartilham.
  tokens/     Design system: cores, raios, espaços, tipografia.
  security/   Derivação de chaves, criptografia de segredos, limite de requisições.
  ota/        Atualização OTA do app: layout do diretório, manifesto, assinatura e o CLI que roda no CI.
  db/         Prisma e as implementações das "stores" e o cofre das chaves.
  ingest/     Fontes de lançamentos: Meu Pluggy (ver pluggy.md) e extratos CSV/OFX/PDF (statement/).
  core/       Engine financeiro: funções puras (próxima fase).
```

### Quem pode importar quem

```
apps/*  ──►  packages/core, db, ingest, security, shared, ota   (ota: só a API)
mobile  ──►  packages/shared, tokens
ingest  ──►  core, db, shared
db      ──►  core, security, shared
core    ──►  shared            (sem banco, sem rede, sem relógio)
tokens, shared, security, ota: não importam nada do projeto
```

Uma seta proibida é sinal de que a coisa está no lugar errado: mova para o pacote certo em vez de criar a seta.

## Módulos da API

Cada assunto é uma pasta em `apps/api/src/modules/` com o que ele precisa:

```
modules/pairing/
  service.ts     regras (funções puras com dependências injetadas)
  routes.ts      rotas Hono do assunto
  auto.ts        o que for específico do assunto
  *.test.ts      testes ao lado do código
```

`app.ts` só monta: middlewares globais + `app.route(...)` de cada módulo. **Feature nova = pasta nova em `modules/` + uma linha em `app.ts`.**

Não há framework de injeção de dependência, nem camadas obrigatórias (controller → service → repository → …). Um módulo pequeno pode ter só `routes.ts`. Quebre em arquivos quando crescer, não antes.

## As três regras que valem a pena

1. **Lógica é função pura com dependências injetadas.** Recebe `store`, `now`, chaves por parâmetro; não chama `new Date()` nem lê `process.env`. Assim todo comportamento é testável sem banco e sem relógio de verdade.
2. **Dados passam por interfaces pequenas** (`AuthStore`, depois `TransactionStore`…), com duas implementações: Prisma e memória. As duas rodam o **mesmo teste de contrato**, então não divergem. A interface descreve o que o negócio precisa ("gaste este código e crie o aparelho"), não o banco.
3. **Bordas validam, o miolo confia.** Tudo que entra (HTTP, env, arquivo, notificação, resposta da IA) passa por Zod na borda. Dentro, os tipos já são confiáveis.

## Como acrescentar uma feature

Exemplo: "lançamentos".

1. **Regras de dinheiro** em `packages/core` (puras, com teste): ex. em qual fatura cai uma compra.
2. **Schema compartilhado** em `packages/shared` (o que o app manda e recebe).
3. **Modelo e migração** em `packages/db` + a interface da store + as duas implementações + teste de contrato.
4. **Módulo** `apps/api/src/modules/transactions/` com rotas e serviço.
5. Uma linha em `app.ts`.
6. No app: bloco em `features/transactions/`, usando primitivos de `ui/` (ver [styleguide](styleguide.md)).

Se algum passo não se aplica, pule. Se a feature não tem regra de dinheiro, não precisa mexer no `core`.

## Atualização OTA do app

`packages/ota` é o contrato entre quem **gera** a atualização (o CLI `pnpm ota`, no GitHub Actions) e quem a **serve** (`apps/api/src/modules/updates/`): o formato do diretório `/app/ota`, os nomes de arquivo (hash no nome, nada de caminho vindo da URL) e a assinatura. O módulo da API segue o padrão de store com duas implementações (`createFsOtaStore` e `createMemoryOtaStore`); o diretório entra por `OTA_DIR` (padrão `/app/ota`), lido só em `env.ts`. Detalhes de uso e segurança em [servidor](servidor.md#atualizar-o-app-sem-apk) e [segurança](seguranca.md#atualização-ota-do-app).

## Idempotência de pedidos que criam coisas

`POST /v1/transactions` e `/v1/transactions/installments` aceitam o cabeçalho `Idempotency-Key` (UUID). A regra mora em `apps/api/src/http/idempotency.ts` (`idempotent(c, deps, body, status, run)`); os dados, na interface `IdempotencyStore` (`packages/db`, Prisma e memória, mesmo teste de contrato).

- Primeira vez: reserva `(aparelho, chave)`, executa, guarda `status` + corpo por 24 h. Só sucesso fica guardado; se `run` falhar, a reserva é desfeita.
- Mesma chave e mesmo pedido (método + caminho + corpo canônico, hash SHA-256): devolve a resposta guardada, com `Idempotent-Replayed: true`. Nada é criado.
- Mesma chave com outro pedido: 422 `chave_reutilizada`. Mesma chave enquanto o primeiro ainda roda: 409 `em_andamento` (o app repete e recebe a resposta guardada).
- Corrida: a unicidade `(device_id, key)` no banco decide quem executa; o outro pedido vê a reserva. Uma reserva sem resposta há mais de 60 s (processo caiu) é retomada.
- Sem o cabeçalho, o pedido executa como antes. O worker apaga as chaves expiradas a cada hora (fila `manutencao`).
- Para acrescentar a outro POST: envolva a criação em `idempotent(...)` na rota e mande o cabeçalho no app (`lib/idempotency.ts`).

## Filtros da lista de lançamentos

`GET /v1/transactions` (e `GET /v1/transactions/count`, que só conta) aceitam filtros opcionais, combinados com E; listas vão separadas por vírgula e o `cursor` continua valendo sobre o resultado filtrado: `from`/`to` (AAAA-MM-DD, inclusivos), `kinds`, `accountIds`, `cardIds`, `categoryIds`, `sources`, `statuses`, `minCents`/`maxCents` (centavos inteiros, inclusivos). `accountIds` e `cardIds` juntos valem como OU, e a conta também casa com o destino de uma transferência. O schema está em `@orbita/shared` (`transactionFilterFields`), a regra em `TransactionStore.listRecent`/`countMatching` (Prisma e memória, mesmo contrato). No app, `features/activity/filters-model.ts` converte o que o dono marcou na gaveta nesses parâmetros; o estado fica em `filters-store.ts` (memória do app, sobrevive à navegação).

## Importação de extrato

`packages/ingest/src/statement/` lê CSV, OFX e PDF e devolve itens `{ date, amountCents (negativo = saída), description, externalId }` mais avisos e a lista "não entendi estas linhas". É tudo função pura sobre bytes (`parseCsv`, `parseOfx`, `parsePdfLines`); só `parsePdf` faz I/O, ao extrair o texto com o `unpdf` (pdf.js sem worker, MIT). O formato é decidido pelo **conteúdo** (`%PDF-`, cabeçalho OFX), nunca só pela extensão.

- **CSV:** acha o separador (`;` `,` tab) e o cabeçalho pelos nomes das colunas (Nubank, Inter, Itaú, Bradesco, BB, Santander, C6, Caixa). Se data, descrição e valor (ou saída/entrada) não ficam claros, devolve `needs_mapping` com colunas e amostra, e o app pergunta ao dono; a escolha volta no campo `mapping`.
- **Sinal:** em conta, negativo é saída. Em cartão (`cardId`), o valor positivo da fatura é compra; entradas do cartão (pagamento, estorno) não são importadas. `invertSign` troca tudo quando o banco usa o contrário.
- **Identificador:** FITID/coluna de id do banco quando é único no arquivo; senão um hash de data + valor + descrição + "ocorrência" (o enésimo item igual), que não muda se o banco reexportar um período diferente. O `externalId` gravado é `account:<id>:` ou `card:<id>:` + esse id, porque o mesmo FITID pode existir em duas contas.
- **Serviço** (`previewStatement`, `importStatement`): confere o destino, lê, classifica cada item (`new`, `duplicate` por `existsByExternal("import", …)`, `possible_duplicate` por mesma data e valor via `TransactionStore.listByTarget`), aplica as regras de categoria aprendidas e grava com `upsertByExternal` como `pending` e origem `import`. Compra no cartão ganha a fatura pelo engine (`invoiceFor`). Possíveis duplicatas só entram se o dono pedir (`includePossibleDuplicates`).
- **Idempotência do arquivo:** `ImportBatchStore` (Prisma e memória, mesmo teste de contrato) guarda o SHA-256 do arquivo + destino e os números do resultado. Reenviar o mesmo arquivo devolve o resumo anterior (`already_imported`); envios simultâneos: um importa, os outros veem a reserva (409 `em_andamento`); se a importação falha, a reserva é desfeita.
- **API** (`apps/api/src/modules/imports/`): `POST /v1/imports/preview` e `POST /v1/imports`, multipart (`file`, `accountId` ou `cardId`, `mapping`, `invertSign`, `includePossibleDuplicates`). O limite global de 16 KB não vale para `/v1/imports*`; o módulo aplica 5 MB depois de autenticar.
- **App:** Configurações → Comprovantes e arquivos (`/configuracoes/arquivos`) → Importar extrato (`/configuracoes/importar`): arquivo (`expo-document-picker`) → conta ou cartão → resumo do servidor → colunas, se preciso → "Importar N". Termina em **Para revisar** (`/revisao`), que confirma os pendentes. `expo-document-picker` é módulo nativo: precisa de **APK novo** (não chega por OTA; o `runtimeVersion` muda).

## Perfil, preferências, exportação e backup

Telas de Configurações com módulos próprios na API:

- **Preferências** (`modules/preferences`): `GET/PATCH /v1/profile` (nome do dono, usado na saudação do Início e do chat, e nome do aparelho, via `AuthStore.renameDevice`), `/v1/preferences` (conta padrão do Novo lançamento, que só pode ser conta ativa) e `/v1/notification-settings` (escolhas da tela Notificações do celular). Os dados ficam em `PreferencesStore` (Prisma e memória, mesmo contrato), numa única linha (`app_preferences`, id `main`). **A captura de notificações do banco não existe ainda**: o servidor só guarda as escolhas e devolve `active: false`; a tela diz isso. "Esconder valores ao abrir" é preferência do aparelho (armazenamento local), não do servidor.
- **Exportação** (`modules/export`): `GET /v1/export?format=csv|json&include=transactions,categories,accounts,subscriptions&from&to`. JSON com centavos inteiros e os mesmos DTOs da API; CSV (BOM, `;`, CRLF) com dinheiro formatado ("-46,90") e **um tipo de dado por arquivo**. Aparelho pareado obrigatório, 10 pedidos por 10 minutos por aparelho, `Cache-Control: no-store`. Nunca leva chaves do cofre, tokens nem aparelhos. No app: Configurações → Exportar tudo, que grava no cache e abre a folha de compartilhar (`expo-file-system` e `expo-sharing`, **módulos nativos novos: exigem APK novo**) ou baixa no navegador.
- **Backup:** não há job no app nem na API. O backup do Postgres é do Dokploy (ver [servidor](servidor.md#backup)); a tela só explica e aponta para as instruções. O app não sabe se um backup rodou, e por isso não mostra "último backup".
- **Reportar problema:** monta uma issue pré-preenchida (`ali-ali18/Orbita`) e abre no navegador; nada sai do app sozinho. Só versão, plataforma, sistema e modelo do aparelho, sem valores, nomes, nome do aparelho dado pelo dono nem endereço do servidor.

## Orçamento: sugestão, aviso e sobra

- **Sugestão da Órbita** (`GET /v1/budgets/suggestion`): `suggestBudget` (`packages/core`) pega a **mediana** do gasto de cada categoria nos 3 últimos meses **fechados** (o mês corrente fica de fora), em reais inteiros; mês sem gasto é ignorado. O gasto de cada mês vem do mesmo `monthSummary` do Início. Determinístico, sem IA. "Usar sugestão" grava o total e um limite por categoria (um PUT por limite) e pede confirmação se for trocar limites existentes.
- **Avisar quando passar de X%:** `budgetAlertPercent` (1 a 100, padrão 80) fica em `AppPreferences`. `passedThreshold` (core, só inteiros) decide, e o resumo do mês devolve `alert` por limite. **O push não existe ainda**: o aviso aparece só dentro do app (linha no card do Início e na tela Orçamento).
- **Sobra do mês vai para:** `leftoverAccountId` (conta ativa ou nenhuma) em `AppPreferences`. Só a escolha é guardada; nenhum dinheiro é movido. Metas ainda não existem ("Metas: em breve").

## Pagar a fatura e lembrete de assinatura

- **Marcar como paga:** `POST /v1/cards/:id/invoices/:month/pay` (`{ accountId }`, aceita `Idempotency-Key`) cria o `card_payment` do que falta da fatura. O valor (total menos o já pago) e a situação vêm do engine (`paidForInvoice`, `paymentStatus`); o cliente só escolhe a conta. Recusa fatura aberta (400) e já paga (409). A data é hoje, limitada à janela de pagamentos da fatura (`paymentWindow`), para que o engine a atribua à fatura certa. Pagamento parcial fica fora (o Figma só tem o botão). "Desfazer" é o `DELETE /v1/transactions/:id` de sempre; a fatura volta a "não paga". No app: `features/card/PayInvoice.tsx`.
- **Lembrar 1 dia antes:** `Recurrence.remindDayBefore` (padrão `false`, nas duas stores, no schema e no DTO). Só guarda a escolha: **não há push ainda**, e a tela diz que o lembrete começa a valer quando as notificações existirem. Nada dispara aviso por esse campo.
- **Buscar serviço:** `features/subscriptions/catalog.ts`, lista estática no app (nome, categoria padrão, apelidos), sem rede e sem valor sugerido.

## Tarefas em segundo plano

O worker tem filas por assunto (`manutencao`, `sincronizacao`, depois `alertas`). Cada processador é uma função pura testável (`cleanPairingCodes({ store, now })`, `cleanIdempotencyKeys`); o arquivo `index.ts` só liga fila → função. Decidir **se** algo deve acontecer (avisar, sincronizar) é código determinístico; a IA só escreve o texto.

## Configuração

- Variáveis de ambiente são lidas e validadas **uma vez**, no `env.ts` de cada app, e falham cedo com a lista do que falta.
- Um só segredo mestre (`APP_SECRET`); cada uso deriva a própria chave (ver [segurança](seguranca.md)). A API e o worker precisam do mesmo `APP_SECRET`: os dois abrem o mesmo cofre (`createSecretVault`, em `packages/db`).
- Valores com padrão sensato não precisam aparecer no `.env`.

## Build e deploy

Sem etapa de build de TypeScript: `tsx` roda o código direto, e o CI garante tipos e testes. A imagem Docker é construída e publicada pelo GitHub Actions; o servidor só baixa (ver [servidor](servidor.md)).
