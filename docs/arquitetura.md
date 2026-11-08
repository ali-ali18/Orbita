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
  agents/     Ferramentas, prompt e laço da IA (Anthropic). Só fala com o mundo por portas injetadas.
```

### Quem pode importar quem

```
apps/*  ──►  packages/core, db, ingest, security, shared, ota, agents   (ota: só a API)
mobile  ──►  packages/shared, tokens
ingest  ──►  core, db, shared
db      ──►  core, security, shared
core    ──►  shared            (sem banco, sem rede, sem relógio)
agents  ──►  core, shared      (sem banco; lê e escreve por portas que a API implementa)
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

## Chat com a IA (`packages/agents` + `modules/chat`)

O chat não tem regra própria de dinheiro: toda resposta vem de um modelo da Anthropic que **só chama ferramentas** e copia o que elas devolvem. O app não calcula nada (`features/chat/reply.ts`, que respondia por regras locais, foi removido).

**`packages/agents`** (sem banco, sem rede, sem relógio; testes com cliente falso):

- `read-tools.ts`: resumo do mês, busca de lançamentos, orçamento, fatura, assinaturas, gasto por categoria, relatório do mês (comparação com o anterior) e catálogo (ids de contas, cartões e categorias). Cada uma devolve JSON com **centavos inteiros e texto já formatado** e, quando cabe, um `card` para o app. Somas e porcentagens que a ferramenta precisa fazer são em inteiros, dentro dela; o modelo nunca soma.
- `write-tools.ts`: `propose_create_transaction`, `propose_categorize_transaction`, `propose_confirm_transaction`. **Nenhuma grava**: valida, confere as referências e devolve uma *proposta*. O valor entra como texto em reais ("46,90") e a ferramenta o converte (`parseBRL`), então o modelo nunca multiplica por 100.
- `proposals.ts`: `applyProposal`/`undoProposal`, a única parte que escreve, chamada só quando o dono toca em Confirmar ou Desfazer.
- `loop.ts` (`runAgent`): o laço modelo → ferramentas → modelo, escrito à mão em vez do Tool Runner do SDK porque o servidor precisa de controle em cada volta (checar o limite de gasto **antes** de cada chamada, registrar o custo de **cada** chamada, interceptar propostas e transmitir texto e cards no meio do caminho). O modelo entra pela porta `ModelClient`; `anthropic-client.ts` é o único arquivo que importa o SDK.
- `prompt.ts`: prompt em pt-BR dividido em parte **estável** (em cache de prompt, junto com as ferramentas) e **contexto** (data e nome do dono, depois do trecho em cache). Nada que varia entra na parte estável.
- `pricing.ts`: a **única** tabela de preços (micro-dólares por milhão de tokens), com o aviso para conferir no site da Anthropic. `models.ts`: modelo padrão e a regra do modelo barato.
- `AgentReader`/`AgentWriter` (`backend.ts`): as portas que a API implementa em `modules/chat/backend.ts` com os mesmos serviços das telas (`monthSummary`, `cardInvoice`, `createTransaction`…). Quem fizer outro agente (Vigia, Fechamento…) importa só a API pública de `packages/agents/src/index.ts`.

**API** (`apps/api/src/modules/chat/`):

- `POST /v1/chat` responde em **SSE** (`meta`, `text`, `tool`, `card`, `done`, `error`; schema em `@orbita/shared`). Recusas que vêm antes do fluxo são JSON com código: `sem_chave_anthropic` (409), `chave_ilegivel` (409), `limite_mensal_ia` (403) e `muitas_tentativas` (429, 30 pedidos por aparelho a cada 10 minutos). O fluxo para quando o app fecha a conexão.
- Conversas e mensagens ficam no servidor (`ChatStore`, Prisma e memória, mesmo teste de contrato): `GET /v1/chat/conversations`, `GET`/`DELETE /v1/chat/conversations/:id`. As últimas 20 mensagens vão ao modelo como contexto, com uma linha por card (consulta feita, proposta e situação).
- **Propostas**: `POST /v1/chat/proposals/:id/confirm|cancel|undo`. A troca de situação é comparar-e-trocar atômica (`transitionProposal`): dois toques seguidos executam uma vez só (o outro leva 409). Se a execução falha, a proposta volta a `pending`. O Desfazer devolve o estado anterior (apaga o lançamento criado, restaura a categoria e a flag "escolhida pelo dono", volta o lançamento a pendente).
- **Custo**: cada chamada ao modelo grava `AiUsage` (tokens e custo em micro-dólares **inteiros**, arredondado para cima uma vez por chamada; modelo fora da tabela paga o maior preço). `GET`/`PUT /v1/settings/ai` mostram o gasto do mês e trocam o **limite mensal** (centavos de dólar; padrão US$ 10; `null` = sem limite). No limite, o chat devolve a mensagem em pt-BR e nem chama o modelo; o limite também é conferido a cada volta do laço.
- **Modelo por ambiente**: `CHAT_MODEL` (padrão `claude-sonnet-5-5`), `CHAT_MODEL_FAST` (`claude-haiku-5-5`; `off` desliga) e `CHAT_EFFORT` (`low`). Só a primeira mensagem de uma conversa, curta, sem número e sem verbo de escrita usa o modelo barato (`pickModel`). A chave da Anthropic vem do cofre (`vault.read("anthropic_api_key")`) a cada pedido.

**App** (`features/chat/`): `chat-client.ts` lê o SSE com `expo/fetch` (o `fetch` do React Native não lê em streaming), `chat-model.ts` é o estado (funções puras), `ChatView.tsx` desenha texto, cards de consulta e o card de proposta (Confirmar/Cancelar; depois de confirmada, Desfazer e Ver lançamento). Sem chave, o aviso do servidor ganha o botão que abre Servidor e chaves. O microfone continua desligado; comprovante e foto seguem como estavam.

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

## Categoria sugerida, dividir e repetir um lançamento

- **Sugestão de categoria** (Novo lançamento): só regras, nunca IA. `features/transactions/category-suggestion.ts` aplica as regras aprendidas (`GET /v1/category-rules`, a mesma `pickCategoryRule` de `@orbita/shared` que o sync usa) à descrição digitada. A sugestão vem marcada; o dono aceita ("Aceitar"), troca ("Trocar") ou escolhe outra. Só vale para saída e para categoria ativa.
- **Dividir** (Detalhe → Dividir): `POST /v1/transactions/:id/split` com `{ parts: [{ amountCents, categoryId?, description? }] }` (2 a 20 partes, aceita `Idempotency-Key`). A soma é conferida pelo engine (`checkSplit`, `packages/core/src/split.ts`) dentro do store, que valida de novo no servidor. `TransactionStore.splitTransaction` apaga o original (a identidade externa dele continua reservada, então a ingestão não o recria) e cria as partes numa operação só, com o mesmo `splitGroupId` (coluna `split_group_id`, sem unicidade; parcela usa `installmentGroupId`, que é outra coisa). Cada parte herda data, conta ou cartão, fatura, mês do orçamento, situação e origem; a categoria fica marcada como escolhida pelo dono. Só despesa e receita avulsas dividem (nada de parcela, transferência, pagamento de fatura, estorno, nem gasto com estornos vivos). Dividir uma parte de novo mantém o grupo.
- **Repetir** (Detalhe → Repetir): usa o módulo `recurrences` (o das Assinaturas) sem rota nova: `features/transactions/repeat-model.ts` monta o `RecurrenceCreateBody` com nome, valor, categoria, conta ou cartão e dia do lançamento, começando no mês seguinte para não contar o lançamento atual duas vezes.

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
- **Sobra do mês vai para:** `leftoverAccountId` (conta ativa) **ou** `leftoverGoalId` (meta ativa), nunca os dois: escolher um desfaz o outro, e arquivar a meta desfaz a escolha (nas duas stores, mesmo teste de contrato). Só a escolha é guardada; nenhum dinheiro é movido. No app, a gaveta lista "Nenhuma", as contas e as metas.

## Metas

Meta de guardar dinheiro, de ponta a ponta (Figma "Metas" e "Nova meta"):

- **Dados** (`packages/db`, migração `20261113090000_metas`): `goals` (nome, `targetCents`, prazo opcional, conta opcional só informativa, `icon` de uma lista fixa em `@orbita/shared`, `chartSlot` 0 a 9 na paleta dos gráficos, `archivedAt`) e `goal_contributions` (`amountCents` > 0, data, `transactionId` opcional, só referência). O **guardado não é coluna**: é a soma das contribuições. `GoalStore` tem Prisma e memória, com o mesmo teste de contrato (`goal-store.contract.test.ts`). Meta arquivada some da lista, mantém as contribuições e não aceita edição nem "Guardar".
- **Engine** (`packages/core/src/goals.ts`, tudo inteiro, sem relógio): `goalProgress` (percentual para baixo; 100 só ao atingir), `monthlyNeeded` (o que falta ÷ meses até o prazo, para cima; mês do prazo = o corrente conta 1; prazo vencido = tudo agora), `goalPace` (média dos últimos 3 meses, sem contar meses antes de a meta existir), projeção (`projectedDate`, nula se o ritmo é zero ou passa de 100 anos) e a situação: `reached`, `no_deadline`, `on_track` (ritmo ≥ o necessário) ou `behind`. Meta criada no mês corrente sem nada guardado ainda conta como `on_track` (não há ritmo a cobrar). `summarizeGoal(input, today)` junta tudo.
- **API** (`apps/api/src/modules/goals/`): `GET /v1/goals` (ativas, com os números do engine e `totals`), `POST /v1/goals`, `GET|PATCH|DELETE /v1/goals/:id` (DELETE arquiva), `POST /v1/goals/:id/contributions` (data opcional, nunca futura; hoje por padrão) e `DELETE /v1/goals/:id/contributions/:contributionId`. Toda resposta de escrita devolve a meta já recalculada. Entrada validada por Zod (`goals-api.ts` em `@orbita/shared`); escritas limitadas a 120 por 10 minutos por aparelho (leitura livre).
- **App** (`features/goals/`): lista (`/metas`), detalhe (`/meta?id=`), nova/editar (`/nova-meta`, com `?id=` edita) e "Guardar" numa gaveta (`ValueSheet`). Entrada: Configurações → Organização → Metas (o Figma não mostra por onde se chega). Os números só são mostrados, nunca recalculados; a única conta no app é a prévia "Você precisa guardar R$ X por mês" do formulário, com a mesma `monthlyNeeded` do engine. **Guardar só registra o valor**: nenhum dinheiro sai de conta nenhuma.
- **Fora desta entrega** (o Figma mostra, mas depende de coisas que não existem): os cartões "Metas diz" (texto de agente), "Guardar a sobra do mês sozinho" (moveria dinheiro sozinho) e "Me avisar se sair do ritmo" (push), e a linha "nos últimos 3 meses sobrou em média" do formulário.

## Relatório do mês

`monthReport` (`packages/core/src/report.ts`) é a função pura que monta o relatório; ela não acha nem soma nada que o engine já calcula: o resumo de cada mês é o `summarizeMonth`, o orçamento é o `budgetStatus` e a fatura é a `invoiceComposition`. Entrega totais (entrou, saiu, sobra), a comparação com o mês anterior e com a **média dos até 3 meses anteriores que tiveram movimento** (mês vazio não puxa a média para baixo), as categorias com variação, as maiores despesas, o total de assinaturas (lançamentos que nasceram de recorrência), a aderência ao orçamento e a fatura de cada cartão. Percentuais são inteiros (`percentChange`, arredondamento simétrico, `null` sem referência).

- **API** (`apps/api/src/modules/reports/`): `GET /v1/reports` lista os meses com lançamento (`TransactionStore.listBudgetMonths`) e `GET /v1/reports/:month` (AAAA-MM) devolve o relatório. O serviço lê com o mesmo mapeamento de categoria do Início (`toCoreTransaction`), então os totais batem com `/v1/summary/:month`. Nada é pré-calculado nem guardado: o worker não tem job para isso.
- **App** (`features/report/`): tela Relatório (Início → "Relatório do mês"), seletor de meses, barras por categoria contra o mês anterior, e "Exportar" leva à tela de exportação existente. O texto "Fechamento" é um **modelo fixo** (`narrative`, em `report-model.ts`) feito só com os números do relatório; o `TODO(ia-resumo)` marca onde o resumo por IA entra depois. O botão "Mover para a meta" do Figma fica de fora até existirem metas.

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
