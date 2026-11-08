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
  ingest/     Fontes de lançamentos: cliente e sincronização do Meu Pluggy (ver pluggy.md).
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

## Tarefas em segundo plano

O worker tem filas por assunto (`manutencao`, `sincronizacao`, depois `alertas`). Cada processador é uma função pura testável (`cleanPairingCodes({ store, now })`, `cleanIdempotencyKeys`); o arquivo `index.ts` só liga fila → função. Decidir **se** algo deve acontecer (avisar, sincronizar) é código determinístico; a IA só escreve o texto.

## Configuração

- Variáveis de ambiente são lidas e validadas **uma vez**, no `env.ts` de cada app, e falham cedo com a lista do que falta.
- Um só segredo mestre (`APP_SECRET`); cada uso deriva a própria chave (ver [segurança](seguranca.md)). A API e o worker precisam do mesmo `APP_SECRET`: os dois abrem o mesmo cofre (`createSecretVault`, em `packages/db`).
- Valores com padrão sensato não precisam aparecer no `.env`.

## Build e deploy

Sem etapa de build de TypeScript: `tsx` roda o código direto, e o CI garante tipos e testes. A imagem Docker é construída e publicada pelo GitHub Actions; o servidor só baixa (ver [servidor](servidor.md)).
