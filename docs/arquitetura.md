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
  agents/     Ferramentas, prompt e laço da IA (Anthropic), e os avisos dos agentes. Só fala com o mundo por portas injetadas.
  ledger/     Leituras que juntam stores e engine (resumo do mês, fatura, limite, saldo, fluxo de caixa, gasto dia a dia, relatório, metas, leitor dos agentes). A API e o worker usam as mesmas.
```

### Quem pode importar quem

```
apps/*  ──►  packages/core, db, ingest, security, shared, ota, agents, ledger   (ota: só a API)
mobile  ──►  packages/shared, tokens
ingest  ──►  core, db, shared
db      ──►  core, security, shared
core    ──►  shared            (sem banco, sem rede, sem relógio)
agents  ──►  core, shared      (sem banco; lê e escreve por portas que a API e o worker implementam)
ledger  ──►  core, db, ingest, shared, agents   (só tipos das portas de `agents`)
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

- `read-tools.ts`: resumo do mês, busca de lançamentos, orçamento, fatura, assinaturas (`list_subscriptions` devolve as **cadastradas** e as **detectadas no histórico** como sugestões, com totais já somados em inteiros; a IA oferece cadastrar as sugestões via `analyze_history` + `propose_setup`), gasto por categoria, relatório do mês (comparação com o anterior) e catálogo (ids de contas, cartões e categorias). Cada uma devolve JSON com **centavos inteiros e texto já formatado** e, quando cabe, um `card` para o app. Somas e porcentagens que a ferramenta precisa fazer são em inteiros, dentro dela; o modelo nunca soma.
- **Totais prontos e nomes de app**: `list_subscriptions` devolve `totals` como **primeiro** campo (`registeredExpensesPerMonth`, `suggestedPerMonth`, `registeredPlusSuggestedPerMonth`); para somar só alguns itens a IA chama de novo com `keys` (as `key` das detectadas e os `id` das cadastradas) e copia `totals.selectedPerMonth`, nunca soma. Cada sugestão traz `name` (o app: "YouTube", "ChatGPT (Google Play)", "Pierre", de `serviceDisplayName` em `packages/core/src/known-services.ts`, ou o estabelecimento limpo) e o `merchant` cru do banco; o card usa o `name`. A marca une os nomes do mesmo serviço (`OPENAI *CHATGPT` e `DL*GOOGLE ChatGP`; `SuperGrok`, `X.AI` e `Grok`; `Google Play <app>` usa o app), então cobranças que o banco escreve de jeitos diferentes por mês continuam uma sequência só; app conhecido ou do Google Play precisa de 2 cobranças mensais, as outras marcas de 3. `search_transactions` põe no título do card o recorte consultado (conta, cartão, categoria, período) e avisa o modelo quando a busca não filtra conta nem cartão, para o card de uma conferência de extrato bater com o que a IA olhou.
- `write-tools.ts`: `propose_create_transaction`, `propose_categorize_transaction`, `propose_confirm_transaction` (e `propose_apply_plan` e `propose_setup`, de [renda](#renda-e-plano-do-mês) e [configurar](#configurar-com-a-órbita)). **Nenhuma grava**: valida, confere as referências e devolve uma _proposta_. O valor entra como texto em reais ("46,90") e a ferramenta o converte (`parseBRL`), então o modelo nunca multiplica por 100.
- `proposals.ts`: `applyProposal`/`undoProposal`, a única parte que escreve, chamada só quando o dono toca em Confirmar ou Desfazer.
- `loop.ts` (`runAgent`): o laço modelo → ferramentas → modelo, escrito à mão em vez do Tool Runner do SDK porque o servidor precisa de controle em cada volta (checar o limite de gasto **antes** de cada chamada, registrar o custo de **cada** chamada, interceptar propostas e transmitir texto e cards no meio do caminho). O modelo entra pela porta `ModelClient`; `anthropic-client.ts` é o único arquivo que importa o SDK.
- `grounding.ts` (conferência da saída, ligada em `runAgent`): todo valor "R$" do texto final tem de existir em algum resultado de ferramenta da conversa (ou ter sido dito pelo dono, ou estar no histórico), com normalização pt-BR (`R$ 1.234,56`, `R$ 1234,56`, `R$ 95` aceita o arredondamento de um valor existente). Se não existir, o texto **não é mostrado**: o laço devolve ao modelo um aviso para refazer sem o número (uma vez; ele pode chamar a ferramenta do total ou dizer que não calcula) e, se insistir, o valor vira "(valor não confirmado)". Para isso o texto sai por frases (a frase com "R$" fica retida até o fim da volta). Não age quando há anexo (o modelo lê valores da imagem). Só valores com "R$" são conferidos; é uma rede de proteção, a regra continua sendo o modelo copiar o campo `text`.
- `prompt.ts`: prompt em pt-BR dividido em parte **estável** (em cache de prompt, junto com as ferramentas) e **contexto** (data e nome do dono, depois do trecho em cache). Nada que varia entra na parte estável.
- `pricing.ts`: a **única** tabela de preços (micro-dólares por milhão de tokens), com o aviso para conferir no site da Anthropic. `models.ts`: modelo padrão e a regra do modelo barato.
- `AgentReader`/`AgentWriter` (`backend.ts`): as portas que a API implementa em `modules/chat/backend.ts` com os mesmos serviços das telas (`monthSummary`, `cardInvoice`, `createTransaction`…). Quem fizer outro agente (Vigia, Fechamento…) importa só a API pública de `packages/agents/src/index.ts`.

**API** (`apps/api/src/modules/chat/`):

- `POST /v1/chat` responde em **SSE** (`meta`, `text`, `tool`, `card`, `done`, `error`; schema em `@orbita/shared`). Recusas que vêm antes do fluxo são JSON com código: `sem_chave_anthropic` (409), `chave_ilegivel` (409), `limite_mensal_ia` (403) e `muitas_tentativas` (429, 30 pedidos por aparelho a cada 10 minutos). O fluxo para quando o app fecha a conexão.
- Conversas e mensagens ficam no servidor (`ChatStore`, Prisma e memória, mesmo teste de contrato): `GET /v1/chat/conversations`, `GET`/`DELETE /v1/chat/conversations/:id`. As últimas 20 mensagens vão ao modelo como contexto, com uma linha por card (consulta feita, proposta e situação).
- **Propostas**: `POST /v1/chat/proposals/:id/confirm|cancel|undo`. A troca de situação é comparar-e-trocar atômica (`transitionProposal`): dois toques seguidos executam uma vez só (o outro leva 409). Se a execução falha, a proposta volta a `pending`. O Desfazer devolve o estado anterior (apaga o lançamento criado, restaura a categoria e a flag "escolhida pelo dono", volta o lançamento a pendente).
- **Agente (`agentId`)**: `POST /v1/chat` aceita `agentId` opcional ("Conversar com o agente"); ver [Agentes e avisos](#agentes-e-avisos).
- **Custo**: cada chamada ao modelo grava `AiUsage` (tokens e custo em micro-dólares **inteiros**, arredondado para cima uma vez por chamada; modelo fora da tabela paga o maior preço). `GET`/`PUT /v1/settings/ai` mostram o gasto do mês e trocam o **limite mensal** (centavos de dólar; padrão US$ 10; `null` = sem limite). No limite, o chat devolve a mensagem em pt-BR e nem chama o modelo; o limite também é conferido a cada volta do laço.
- **Modelo escolhido no app**: em _Configurações → Servidor e chaves → IA_ o dono escolhe o modelo do chat e o rápido (`ai_settings.chat_model` / `chat_model_fast`; `off` desliga o rápido). Os ids permitidos são `CHAT_MODEL_OPTIONS` em `packages/agents/src/models.ts` (um lugar só; preço de cada um em `pricing.ts`) e a API recusa o resto com 400. O salvo vence; sem nada salvo valem as variáveis abaixo (`resolveChatModels`). `GET /v1/settings/ai` devolve a lista com o preço por milhão de tokens e o evento `meta` do chat traz o modelo que respondeu.
- **Modelo por ambiente (padrão)**: `CHAT_MODEL` (padrão `claude-sonnet-5-5`), `CHAT_MODEL_FAST` (`claude-haiku-5-5`; `off` desliga) e `CHAT_EFFORT` (`low`). Só a primeira mensagem de uma conversa, curta, sem número e sem verbo de escrita usa o modelo barato (`pickModel`). A chave da Anthropic vem do cofre (`vault.read("anthropic_api_key")`) a cada pedido.

**App** (`features/chat/`): `chat-client.ts` lê o SSE com `expo/fetch` (o `fetch` do React Native não lê em streaming), `chat-model.ts` é o estado (funções puras), `ChatView.tsx` desenha texto, cards de consulta e o card de proposta (Confirmar/Cancelar; depois de confirmada, Desfazer e Ver lançamento). Sem chave, o aviso do servidor ganha o botão que abre Servidor e chaves. O campo de digitar fica dentro do `KeyboardAvoidingView` de `react-native-keyboard-controller` (com `KeyboardProvider` na raiz): no Android 15+ a tela é de ponta a ponta e o sistema não encolhe a janela, e o `KeyboardAvoidingView` do React Native erra a conta (o teclado cobria o campo); o do keyboard-controller lê os insets reais do teclado. É módulo nativo (exige APK novo, junto com reanimated e worklets, que ele pede). A lista rola para a última mensagem quando o teclado abre (`KeyboardEvents`) e a cada mensagem nova.

**Anexos** (foto ou PDF, para a IA ler comprovante e nota):

- **Pedido**: `POST /v1/chat` aceita `attachments` (até 3; `{ mediaType, data }` com `data` em base64): `image/jpeg`, `image/png`, `image/webp` ou `application/pdf`, até **5 MB** cada depois de decodificar (`chatAttachmentSchema` em `@orbita/shared`; tipo e tamanho vêm daí, com mensagem em pt-BR, 400). Sem `message`, vale o texto padrão "Leia o anexo…". Não combina com `intent`. Só `POST /v1/chat` tem o limite de corpo maior (`CHAT_MAX_BODY_BYTES`, aplicado depois de autenticar); o resto da API segue com 16 KB.
- **Conferência no servidor** (`checkAttachments`, `packages/agents/src/attachments.ts`): além do tipo declarado, os primeiros bytes do arquivo têm de bater (JPEG, PNG, WebP, `%PDF-`); senão 400 `anexo_invalido`.
- **Para o modelo**: `buildUserContent` monta a mensagem do dono como blocos `[aviso de que o arquivo é dado, image|document (base64)…, texto do dono]`, passada ao laço em `userContent`. O modelo principal lê o anexo (o barato nunca). Os números continuam vindo do engine e a escrita só por `propose_*` com confirmação.
- **Persistência**: o binário **não** vai para o banco nem para as voltas seguintes. A mensagem do dono é gravada como o texto mais a linha `📎 anexo` (`ATTACHMENT_MARKER`); no contexto das próximas voltas o modelo vê só esse marcador.
- **App** (`attach-native.ts`, regras puras em `attachment-model.ts`): o "+" abre _Tirar foto_ (`expo-image-picker`, câmera), _Escolher da galeria_ e _Documento (PDF)_ (`expo-document-picker`). A foto é reduzida (maior lado 1600 px) e regravada em JPEG com qualidade 0,8 pelo `expo-image-manipulator`, o que a deixa muito abaixo de 5 MB; o PDF é recusado antes de ler se passar de 5 MB. O anexo escolhido aparece como um chip acima do campo (com ✕ para remover) e sai junto com a próxima mensagem. Erros (tipo, tamanho, permissão negada) aparecem como aviso no chat.

**Ditado por voz** (`use-dictation.ts`, regras puras em `dictation-model.ts`): o botão de microfone do campo usa `expo-speech-recognition` em `pt-BR` com resultados parciais, `continuous: false` e `requiresOnDeviceRecognition` quando o aparelho tem o pacote de voz offline (senão usa o serviço de voz do sistema, que pode mandar o áudio ao Google). A fala vai para o campo somada ao que já estava digitado; o dono revisa e envia, nada é enviado sozinho. O botão só aparece se `isRecognitionAvailable()` (na web, esconde onde o navegador não tem reconhecimento de voz).

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

## Widgets do Início

O Início é uma grade de **widgets** que o dono personaliza. O catálogo e as regras são puros e moram em `packages/shared/src/home-layout.ts` (o app e a API usam as mesmas funções):

- **Catálogo** (`HOME_WIDGETS`): ids estáveis (`hero`, `wallet`, `balance`, `limit`, `cashflow`, `installments`, `categories`, `subscriptions`, `report`, `recent`), o nome, os **tamanhos que cada um tem** e o tamanho padrão. Tamanhos: `2x2` (quadrado de meia largura), `2x4` (largura cheia, baixo) e `4x4` (largura cheia, alto). Cada widget tem uma versão desenhada para cada tamanho que declara (ex.: Limite 2x2 = anel + disponível; 2x4 = anel + usado/disponível; 4x4 = uma barra por cartão). Tamanho sem versão não entra no catálogo.
- **Layout** (`HomeLayoutItem[]`): ordem, tamanho e visibilidade de cada widget. Os visíveis vêm sempre antes dos ocultos. Padrão enxuto: Dá pra gastar 4x4 e Faturas 4x4 de largura cheia, Saldo e Limite 2x2 lado a lado, Gastos por categoria 4x4 e Últimos lançamentos 4x4; o resto fica oculto, pronto para "Adicionar".
- **Migração**: `reconcileHomeLayout` roda a cada leitura. Id que saiu do catálogo ou repetido é descartado, tamanho que o widget deixou de ter volta ao padrão dele e **widget novo entra oculto no fim**, então acrescentar um widget ao catálogo não exige migração de dados.
- **Grade** (`homeRows`): dois 2x2 seguidos ficam lado a lado; um 2x2 sozinho fica na linha, em meia largura; 2x4 e 4x4 ocupam a largura.
- **Servidor** (`modules/home/`): `GET`/`PUT /v1/home/layout`, só configuração, nada financeiro. O PUT recebe a lista inteira (`homeLayoutBody`: ids conhecidos, sem repetição, tamanho que o widget aceita, sem campo extra; 400 com mensagem em pt-BR) e devolve o layout já em dia com o catálogo. Os dados passam por `HomeLayoutStore` (Prisma, tabela `home_layout` de uma linha com `items` JSONB, e memória; mesmo teste de contrato). O layout é do servidor, então vale em todos os aparelhos.
- **App** (`features/summary/widgets/`): `HomeWidgets` desenha a grade e `WidgetBody` escolhe a versão por `(id, tamanho)`. Os blocos antigos (`HeroCard`, `WalletBlock`, `BalanceTile`…) são as versões base; as demais estão em `variants.tsx`, e o widget de assinaturas (`SubscriptionsWidget`) busca as recorrências sozinho (compromisso mensal e contagem vêm do servidor). **Segurar** um widget abre o menu (`WidgetMenu`, uma `Sheet`): Ocultar/Mostrar dados (o mesmo olho do topo), Editar widgets, Remover (`danger`) e o tamanho em segmentos, só com os que o widget tem. O gesto chega aos toques de dentro do widget por `LongPressContext` (`ui/long-press.ts`): um toque com `onPress` engole o segurar do que o cerca, então `Card`, `ListRow` e as faixas da carteira o repassam. "Editar widgets" troca a grade por `WidgetEditor`, que trabalha num rascunho: setas subir/descer (sem biblioteca de arrastar, que seria módulo nativo novo), tirar, tamanho e "Adicionar widget" para os ocultos; "Concluir" salva (PUT, com a tela já mostrando o novo e voltando atrás se o servidor recusar) e "Cancelar" descarta. Remover só oculta: o widget continua na lista para adicionar de novo.
- **Para acrescentar um widget**: id e tamanhos em `HOME_WIDGETS`, uma versão por tamanho em `WidgetBody`, teste do catálogo. Os dados novos que ele precisar vêm de uma rota que já exista; o app não calcula dinheiro.
- Feedback tátil no segurar não existe: `expo-haptics` não está no app e módulo nativo novo exige APK novo.

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

## Renda e plano do mês

Com o salário cadastrado, o app organiza o mês em volta dele. **Nunca sugere gastar mais do que a renda**, e quem faz a conta é o engine.

- **Dados** (`packages/db`, migração `20261115110000_renda`): `income_sources` (nome, `amountCents` > 0, `payday` 1 a 31, conta opcional só informativa, `recurring` e `month`). Recorrente (salário) conta todo mês e não tem mês; avulsa (freela) conta só no `month` dela. `IncomeSourceStore` tem Prisma e memória, com o mesmo teste de contrato.
- **Engine** (`packages/core`): `incomeForMonth` e `nextPayday` (`income.ts`; dia 31 cai no último dia do mês curto), `scaleDownToFit` (`fit-limits.ts`) e `incomePlan` (`income-plan.ts`), tudo em centavos inteiros e determinístico.
  - **Compromissos** (nunca encolhem): recorrências de despesa que caem no mês, parcelas que vencem na fatura do mês (as lançadas e as que o banco ainda não lançou) e o limite das categorias fixas (`FIXED_CATEGORY_SLUGS` = Moradia e Saúde) quando o dono já definiu um.
  - **Dia a dia**: a mediana dos 3 últimos meses fechados (`suggestBudget`) menos o que já é compromisso na categoria, porque o histórico já contém o aluguel pago. Aplicações (`kind: "investment"`) já saem do histórico no engine; `NON_SPENDING_SLUGS` só impede limite e dia a dia na categoria Investimentos. As parcelas vêm de `loadSpendingMonth`, o mesmo gasto por fatura do resto.
  - **Metas**: o `monthlyNeededCents` de cada meta ativa com prazo. **Reserva**: percentual da renda (padrão 10%, de 0 a 100 por pedido).
  - **Regra de ouro**: se compromissos + dia a dia passam de `renda − reserva − metas`, o dia a dia é reduzido proporcionalmente (`scaleDownToFit`: o resto dos centavos vai a quem mais perdeu fração, empate pelo id). O aviso `scaled_to_fit` diz quanto o histórico pedia e o teto que coube. Só os compromissos passando da renda: `feasible: false` e nenhum limite sugerido (nada de plano falso).
  - O orçamento do plano é compromissos + dia a dia (meta e reserva não são gasto) e o total é sempre a soma dos limites das categorias.
- **API** (`apps/api/src/modules/income`, `plan`; a montagem dos dados está em `packages/ledger/src/income-plan.ts`, a mesma que o chat e o worker usam): `GET|POST /v1/income`, `PATCH|DELETE /v1/income/:id`; `GET /v1/plan/:month?reservePercent=`; `POST /v1/plan/:month/apply` (só mês atual ou futuro; grava o total e um limite por categoria e tira os limites de categorias fora do plano; trocar o que o dono já definiu pede `confirm: true`, senão 409; devolve `previous`); `POST /v1/budgets/restore` (o Desfazer) e `POST /v1/budgets/fit` ("Ajustar para caber": reduz os limites das categorias até a soma caber no total, sem encolher o que é compromisso). `GET /v1/budgets/suggestion` com renda cadastrada devolve o plano (limitado à renda) e `cap` com a explicação do corte. Escritas limitadas a 120 (renda) e 60 (plano) por 10 minutos por aparelho.
- **Chat** (`packages/agents/src/income-tools.ts`): `income_plan` (leitura, o plano do engine) e `propose_apply_plan` (só proposta; ao confirmar o servidor aplica o plano e guarda o `previous` para o Desfazer). Entram no prompt e no Cofrinho (só a leitura); agentes do dono podem usar `income_plan`.
- **App** (`features/income/`): Configurações → Organização → Renda (`/configuracoes/renda`, formulário em `/nova-renda`), o card "Organizar com a minha renda" no Orçamento (baldes, avisos, reserva, "Aplicar ao orçamento" com confirmação e Desfazer), o aviso sem bloqueio quando o total passa da renda, "Ajustar para caber" quando as categorias somam mais que o total e "Salário cai em N dias" no Início.
- **Fora desta entrega:** "Meu mês começa no dia" (Preferências) segue "Em breve": um ciclo do mês pelo dia do salário muda orçamento, resumo, faturas e relatório e é uma mudança à parte. Os limites do orçamento não são por mês (um conjunto só); aplicar o plano de novembro vale também depois, até o dono mudar.

## Números do banco: saldo, limite disponível e faturas

O que o banco já informa pelo Pluggy é guardado como veio, para as leituras usarem em vez de recalcular por lançamentos (a mudança das leituras e telas é a fase seguinte; hoje só persiste). Detalhes de campos em [Meu Pluggy](pluggy.md#números-que-o-banco-entrega-saldo-limite-disponível-faturas).

- **`AccountStore.recordBalance(id, cents, at)`** grava `Account.balanceCents` e `balanceSyncedAt` (conta `BANK`; pode ser negativo). **`CardStore.recordAvailable(id, cents, at)`** grava `Card.availableCents` e `limitSyncedAt` (o `limitCents` já existia). As duas não mexem em `updatedAt` (não é edição do dono) e `update` do dono não apaga esses campos. Só a sincronização as chama.
- **`BillStore`** (`packages/db/src/bill-store.ts`, tabelas `card_bills` e `card_bill_payments`): `upsert` idempotente por (`source`, `externalId`) que substitui os pagamentos, `get`, `findByExternal`, `listByCard` e `list` (vencimento mais recente primeiro). Datas são `LocalDate` (`@db.Date`, como o resto), dinheiro em centavos inteiros.
- Prisma e memória seguem o mesmo teste de contrato (`bill-store.contract.test.ts`, e os casos novos em `account-store` e `card-store`). A gravação fica em `packages/ingest/src/pluggy/balances.ts` (função pura com `stores` e `now` injetados); `sync.ts` só a chama.

## Relatório do mês

`monthReport` (`packages/core/src/report.ts`) é a função pura que monta o relatório; ela não acha nem soma nada que o engine já calcula: o resumo de cada mês é o `summarizeMonth`, o orçamento é o `budgetStatus` e a fatura é a `invoiceComposition`. Entrega totais (entrou, saiu, sobra; o investido vai à parte, fora do "saiu"; o cartão pesa na fatura que vence no mês, ver [Definições](plano.md#definições)), a comparação com o mês anterior e com a **média dos até 3 meses anteriores que tiveram movimento** (mês vazio não puxa a média para baixo), as categorias com variação, as maiores despesas, o total de assinaturas (lançamentos que nasceram de recorrência), a aderência ao orçamento e a fatura de cada cartão. Percentuais são inteiros (`percentChange`, arredondamento simétrico, `null` sem referência).

- **API** (`apps/api/src/modules/reports/`): `GET /v1/reports` lista os meses com lançamento (`TransactionStore.listBudgetMonths`) e `GET /v1/reports/:month` (AAAA-MM) devolve o relatório. O serviço lê com o mesmo mapeamento de categoria do Início (`toCoreTransaction`), então os totais batem com `/v1/summary/:month`. Nada é pré-calculado nem guardado: o worker não tem job para isso.
- **App** (`features/report/`): tela Relatório (Início → "Relatório do mês"), seletor de meses, barras por categoria contra o mês anterior, e "Exportar" leva à tela de exportação existente. O texto "Fechamento" é um **modelo fixo** (`narrative`, em `report-model.ts`) feito só com os números do relatório; o `TODO(ia-resumo)` marca onde o resumo por IA entra depois. O botão "Mover para a meta" do Figma fica de fora até existirem metas.

## Pagar a fatura e lembrete de assinatura

- **Marcar como paga:** `POST /v1/cards/:id/invoices/:month/pay` (`{ accountId }`, aceita `Idempotency-Key`) cria o `card_payment` do que falta da fatura. O valor (total menos o já pago) e a situação vêm do engine (`paidForInvoice`, `paymentStatus`); o cliente só escolhe a conta. Recusa fatura aberta (400) e já paga (409). A data é hoje, limitada à janela de pagamentos da fatura (`paymentWindow`), para que o engine a atribua à fatura certa. Pagamento parcial fica fora (o Figma só tem o botão). "Desfazer" é o `DELETE /v1/transactions/:id` de sempre; a fatura volta a "não paga". No app: `features/card/PayInvoice.tsx`.
- **Lembrar 1 dia antes:** `Recurrence.remindDayBefore` (padrão `false`, nas duas stores, no schema e no DTO). Só guarda a escolha: **não há push ainda**, e a tela diz que o lembrete começa a valer quando as notificações existirem. Nada dispara aviso por esse campo.
- **Buscar serviço:** `features/subscriptions/catalog.ts`, lista estática no app (nome, categoria padrão, apelidos), sem rede e sem valor sugerido.

## Agentes e avisos

Cinco agentes da casa (Vigia, Fechamento, Metas, Caça-assinatura, Cofrinho), a Órbita (a conversa, sempre ativa) e os que o **dono** cria. Quem decide se há um aviso é **código determinístico**; a IA só escreve o texto e conversa. Figma: Agentes, cada agente e Criar agente.

- **Dados** (`packages/db`, migração `20261114090000_agentes_e_alertas`): `agents` (`builtinKey` nulo = do dono; `enabled`; agenda `frequency` + `runHour` + `runDay`; `settings` JSON; `model` opcional da lista permitida; `lastRunAt`; do dono ainda `instructions` e `tools`) e `alerts` (`kind`, `title`, `body`, `wordedByAi`, `data` em centavos inteiros, `status` new/seen/dismissed, `transactionId` e `proposalId` opcionais). O par `(agentId, dedupeKey)` é **único**: a chave identifica o achado (`budget:<categoria>:2026-11:alert`, `dup:<a>:<b>`, `closing:2026-10`…), então rodar de novo não duplica nem reabre o que o dono dispensou. `AgentStore` (agentes e avisos, Prisma e memória, um teste de contrato) e `ChatConversation.agentId` (a conversa guarda com qual agente foi aberta).
- **Detectores** (`packages/core`, puros, com teste, sem IA): `detectUnusualSpending` (despesa acima de 3× a **mediana** da categoria e do piso "gasto grande"; precisa de 5 anteriores), `detectDuplicateCharges` (mesmo estabelecimento e valor em até N dias), `detectBudgetThresholds` (reusa `passedThreshold` e o percentual das Preferências), `detectRecurringCharges` (mesma marca, valor parecido, 3+ cobranças com cerca de um mês entre elas, ainda não cadastrada), `detectPriceIncreases`, `goalsBehindPace` (reusa o `summarizeGoal`), `suggestSaving` (sobra projetada, para baixo em R$ 10; só uma sugestão) e `closeMonth` (em cima do `monthReport`). A agenda (`latestOccurrence`, `isDue`) também é do engine: o relógio entra por parâmetro.
- **Avisos** (`packages/agents/src/alerts/`): `collectAlerts(agente, porta)` lê os dados por uma `FindingsPort`, chama os detectores e monta o texto-modelo em pt-BR (`text.ts`). Com ou sem IA, os avisos são os mesmos. A reescrita (`wording.ts`) é **uma chamada sem ferramentas** por agente e por rodada; o texto só vale se todo número e data dele já estavam no modelo (`acceptWording`). Agente do dono (`custom.ts`) é diferente: não há detector para uma instrução livre, então o modelo decide o que dizer com as ferramentas de leitura liberadas e responde `SEM_AVISO` quando não há nada.
- **Worker** (`apps/worker/src/alertas.ts`, fila `alertas`, de hora em hora no fuso de São Paulo): garante os agentes da casa, roda os ligados que estão na hora (`isDue`: a última vez que a agenda caiu ainda não foi atendida; worker parado recupera uma execução, não várias), grava os avisos novos e anota `lastRunAt`. A porta de dados usa o `@orbita/ledger`, então o número do aviso é o da tela. Falha de um agente não derruba os outros e ele tenta na passada seguinte. A reescrita é opcional (`AGENT_AI_WORDING=false` desliga) e usa o modelo do agente, senão o rápido; sem chave, chave ilegível ou acima do limite mensal, o aviso sai com o texto-modelo. O custo entra no `AiUsage` (sem conversa), no **mesmo limite mensal** do chat. Agente do dono sem chave ou acima do limite espera a próxima passada (não é marcado como rodado).
- **API** (`modules/agents`): `GET /v1/agents`, `GET`/`PATCH`/`DELETE /v1/agents/:id`, `POST /v1/agents` (agente do dono: nome, instruções, ferramentas de **leitura** e agenda); `GET /v1/alerts?status&agentId&limit`, `POST /v1/alerts/:id/seen` e `/dismiss`. O PATCH junta as escolhas com as atuais e valida com o schema **estrito** do agente (`agentSettingsSchemas`); a Órbita não desliga; o modelo só vale se estiver na lista permitida (`isMainModel`); nome, instruções e ferramentas são só de agente do dono; agente da casa não se apaga. "Conversar com o agente" é o mesmo `POST /v1/chat` com `agentId` opcional: a conversa usa o papel e o **subconjunto de ferramentas** do agente (`resolvePersona`), guarda o agente e, numa conversa que já existe, vale o agente dela. A Órbita é a única com ferramentas de escrita.
- **App** (`features/agents/`): lista (`/agentes`), tela do agente (`/agente?id=`) e Novo agente (`/novo-agente`), com a linha "Agentes" das Configurações. O que o Figma mostra e depende de coisas que não existem fica de fora (push, "Silêncio", "gasto em horário estranho", comparar rendimento, resumo da semana, "guardar a sobra sozinho", a prévia "se eu estivesse ativo, já teria achado").
- **Como acrescentar um agente da casa:** a chave em `BUILTIN_AGENT_KEYS` e o catálogo em `BUILTIN_AGENTS` (`@orbita/shared`, com o schema das escolhas), o detector em `packages/core`, a função em `alerts/collect.ts` e o texto em `alerts/text.ts`, o papel e as ferramentas em `personas.ts`, as linhas da tela em `agents-model.ts` e a cor em `@orbita/tokens`.

## Configurar com a Órbita

Uma análise do histórico do dono que configura o app: acha as assinaturas, sugere regras de categoria e adivinha o salário. **Os números são do engine; a IA só dá nome e categoria; o dono confirma tudo num card.**

- **Análise** (`packages/ledger/src/setup-analysis.ts`, função pura sobre os lançamentos dos últimos 12 meses, o que existir; menos de 3 meses é avisado em `limitedHistory`; `setup.ts` lê as stores e a chama):
  - **Cobranças mensais:** `findMonthlyRuns` (`packages/core/src/subscription-hunt.ts`, extraído de `detectRecurringCharges`, que continua igual): mesma **marca de assinatura** (`subscriptionBrand` em `known-services.ts`: tira o intermediário de pagamento do começo, "PAYPAL _", "DL_", "PG *", e separa serviços que o mesmo emissor cobra, como Google One e YouTube Music; no **Google Play** ("Google One", "DL*GOOGLE YouTub", "DL *GOOGLE Pierre Cont") a marca é o **app vendido**, o texto depois do último "google", com o nome truncado pelo banco casado por prefixo de 4+ letras ("YouTub" = youtube, "ChatGP" = chatgpt; "DL*GOOGLE Google" é o Google One), e app do Google Play basta com **2 cobranças**; o texto da marca junta o nome do estabelecimento **e** a descrição, porque o Pluggy costuma dar só "Google" no nome), cobranças de **cada faixa de valor** da marca formam uma sequência à parte (dois planos ou dois serviços não se misturam), valor parecido (até 10% da mediana, cobre IOF e câmbio), intervalo de 24 a 37 dias com variação entre intervalos de no máximo 9 dias, cobrança duplicada (mesmo valor em até 3 dias) conta uma vez, 3 cobranças ou **2 se for serviço conhecido** (`known-services.ts`), a última com no máximo 45 dias. Parcela de cartão e lançamento nascido de recorrência não contam. Cada item traz valor típico (mediana), último valor, média, dia, onde cai e ocorrências; planos da mesma marca ganham `key` com o valor (`rec:googleone:9690`). Devolve mediana (centavos), dia usual (mediana dos dias), conta ou cartão mais comum, ocorrências, última data, `registered` (já existe assinatura com a marca) e a categoria provável: regra do dono, depois a categoria que o banco já deu, depois a do catálogo.
  - **Sem categoria ou em "Outros":** agrupados pelo nome do estabelecimento normalizado (`derivePattern`, o mesmo das regras), pelo menos 2 lançamentos, com contagem e total; o que uma regra do dono já cobre não aparece.
  - **Salário:** só se o dono ainda não tem renda; crédito mensal de 3 ou mais meses seguidos, valor parecido e mesmo pagador.
- **Ferramentas** (`packages/agents/src/setup-tools.ts`): `analyze_history` (leitura, devolve a análise com `untrusted()`) e `propose_setup` (só proposta; ver [segurança](seguranca.md#agentes-de-ia)). Entram na Órbita (`ALL_TOOLS`). A tarefa fixa usa `resolveSetupPersona` (só `analyze_history`, `propose_setup` e `list_catalog`) e o bloco `SETUP_INSTRUCTIONS`, depois do trecho estável do prompt.
- **Pontos de entrada:** `POST /v1/chat` com `{ "intent": "setup" }` (sem `message`, sem `conversationId` nem `agentId`; a conversa é nova, com a Órbita). No app: o passo "Analisar meu histórico" do Início (`features/checklist`, feito quando há renda ou assinatura cadastrada) e o botão "Configurar com a Órbita" na tela da Órbita abrem `/chat?intent=setup`, que dispara a tarefa sozinha. O texto que o dono vê é o rótulo do botão; o que o modelo recebe é `SETUP_TASK_TEXT`.
- **Sem IA:** sem chave da Anthropic (ou chave ilegível) ou acima do limite mensal, o mesmo endpoint não recusa: `runTemplateSetup` monta a proposta com `templateSetupProposal` (nome do banco sem prefixo nem código e com iniciais maiúsculas, nome do serviço conhecido quando há; categoria da regra do dono, do banco ou do catálogo, e "Outros" para assinatura sem palpite; regra sem palpite fica sem categoria e desmarcada). Nenhuma chamada ao modelo e nenhum custo.
- **Proposta `setup`** (`ProposalKind`, mesma tabela `chat_proposals`, sem migração): o payload é o próprio card (`setupProposalSchema` em `@orbita/shared`: assinaturas, regras, renda, plano; valores em centavos e o texto formatado). `POST /v1/chat/proposals/:id/confirm` aceita um corpo opcional `{ setup: { subscriptions, categoryRules, income, applyPlan } }` com **só** nome, categoria e o que está marcado; sem corpo, vale tudo como foi proposto (e item sem categoria pede para escolher). `resolveSetupSelection` cruza com a proposta; valor, dia e data são sempre os da proposta.
- **Aplicar numa operação só** (`packages/ledger/src/setup-apply.ts`): confere de novo cada número contra a análise de agora e as referências; cria as recorrências (começam no mês seguinte ao da última cobrança, para não contar duas vezes), as regras (`upsert`), recategoriza os lançamentos antigos que casam e que o dono não editou à mão (se pedido), cria a renda e, por último, aplica o plano da renda (que então já enxerga as assinaturas e a renda novas). As stores não têm transação entre si: cada passo anota o que fez (`SetupUndo`) e, se um falha, os anteriores são revertidos na hora. O **Desfazer** usa o mesmo `undoSetup` (arquiva recorrências e renda, apaga as regras criadas ou devolve a categoria anterior, restaura as categorias dos lançamentos e os limites do orçamento) e é idempotente. O card hidratado mostra só o que foi aplicado, com os nomes que o dono deixou.
- **App** (`features/chat/SetupCard.tsx`, `setup-card-model.ts` com o estado em funções puras): seções "Assinaturas encontradas", "Categorias" e "Renda" / "Orçamento"; cada item tem caixa de marcar, nome e categoria editáveis (gaveta `SetupEditSheet`, com os primitivos `Sheet`/`SheetGroup`/`SheetRow`/`TextField`) e valor só para leitura. "Confirmar selecionados (N)" manda a seleção; depois, "Desfazer".
- **Fora desta entrega:** a análise não propõe encerrar assinatura que parou nem detecta aumento de preço (isso é do Caça-assinatura); o plano da renda usa a reserva padrão (10%); recorrências e renda "desfeitas" ficam arquivadas (as stores não apagam).

## Tarefas em segundo plano

O worker tem filas por assunto (`manutencao`, `sincronizacao`, `alertas`). Cada processador é uma função pura testável (`cleanPairingCodes({ store, now })`, `cleanIdempotencyKeys`); o arquivo `index.ts` só liga fila → função. Decidir **se** algo deve acontecer (avisar, sincronizar) é código determinístico; a IA só escreve o texto.

## Configuração

- Variáveis de ambiente são lidas e validadas **uma vez**, no `env.ts` de cada app, e falham cedo com a lista do que falta.
- Um só segredo mestre (`APP_SECRET`); cada uso deriva a própria chave (ver [segurança](seguranca.md)). A API e o worker precisam do mesmo `APP_SECRET`: os dois abrem o mesmo cofre (`createSecretVault`, em `packages/db`).
- Valores com padrão sensato não precisam aparecer no `.env`.

### Compromisso mensal das assinaturas

`GET /v1/recurrences` devolve, além da lista, `subscriptions: { count, monthlyCents }`, calculado no servidor por `subscriptionCommitment` (`packages/core/src/recurrence.ts`): a soma de **todas** as despesas recorrentes ativas (sem data final, ou com data final de hoje em diante), caiam ou não no mês e já lançadas ou não. A tela de Assinaturas só exibe esse valor e a contagem. Antes o app somava só as que caíam no mês corrente e deixava de fora a que ainda não tinha ocorrência (Associação APC, dia 6, "em 27 dias").

## Build e deploy

Sem etapa de build de TypeScript: `tsx` roda o código direto, e o CI garante tipos e testes. A imagem Docker é construída e publicada pelo GitHub Actions; o servidor só baixa (ver [servidor](servidor.md)).
