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
  db/         Prisma e as implementações das "stores" e o cofre das chaves.
  ingest/     Fontes de lançamentos: cliente e sincronização do Meu Pluggy (ver pluggy.md).
  core/       Engine financeiro: funções puras (próxima fase).
```

### Quem pode importar quem

```
apps/*  ──►  packages/core, db, ingest, security, shared
mobile  ──►  packages/shared, tokens
ingest  ──►  core, db, shared
db      ──►  core, security, shared
core    ──►  shared            (sem banco, sem rede, sem relógio)
tokens, shared, security: não importam nada do projeto
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

## Tarefas em segundo plano

O worker tem filas por assunto (`manutencao`, `sincronizacao`, depois `alertas`). Cada processador é uma função pura testável (`cleanPairingCodes({ store, now })`); o arquivo `index.ts` só liga fila → função. Decidir **se** algo deve acontecer (avisar, sincronizar) é código determinístico; a IA só escreve o texto.

## Configuração

- Variáveis de ambiente são lidas e validadas **uma vez**, no `env.ts` de cada app, e falham cedo com a lista do que falta.
- Um só segredo mestre (`APP_SECRET`); cada uso deriva a própria chave (ver [segurança](seguranca.md)). A API e o worker precisam do mesmo `APP_SECRET`: os dois abrem o mesmo cofre (`createSecretVault`, em `packages/db`).
- Valores com padrão sensato não precisam aparecer no `.env`.

## Build e deploy

Sem etapa de build de TypeScript: `tsx` roda o código direto, e o CI garante tipos e testes. A imagem Docker é construída e publicada pelo GitHub Actions; o servidor só baixa (ver [servidor](servidor.md)).
