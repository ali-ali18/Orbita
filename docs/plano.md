# Plano e arquitetura

Documento vivo. Descreve o que o Órbita é, como as peças se encaixam e a ordem de construção.

## Objetivo

Um organizador financeiro pessoal que:

1. junta contas e cartões de vários bancos sem custo mensal;
2. lança gastos sozinho (notificação, Open Finance, comprovante, extrato) e deixa você revisar o que tiver dúvida;
3. entende fatura de cartão, parcelas e transferências entre contas suas;
4. tem agentes de IA que avisam, resumem e sugerem — mas **nunca fazem conta**.

Fora do escopo: mover dinheiro (Pix, pagamentos). O app só lê.

## Arquitetura

### Peças

| Peça              | Tecnologia                                       | Papel                                                                         |
| ----------------- | ------------------------------------------------ | ----------------------------------------------------------------------------- |
| `apps/mobile`     | Expo (React Native), Expo Router, TanStack Query | Telas, chat, push. Android primeiro.                                          |
| `apps/api`        | Hono                                             | Recebe, valida e chama os pacotes. Chat por SSE.                              |
| `apps/worker`     | BullMQ                                           | Sincroniza o Meu Pluggy, gera relatórios, avalia alertas e recorrências.      |
| `packages/core`   | TypeScript puro                                  | **Engine financeiro**: fatura, parcelas, saldo, orçamento, projeção. Sem I/O. |
| `packages/db`     | Prisma + Postgres                                | Acesso a dados.                                                               |
| `packages/ingest` | TypeScript                                       | Parsers por fonte: notificação, Meu Pluggy, comprovante, CSV/OFX/PDF.         |
| `packages/agents` | SDK da Anthropic (laço de ferramentas)           | Ferramentas, prompts e loop dos agentes.                                      |
| `packages/shared` | Zod                                              | Schemas compartilhados entre app e API.                                       |

Infra: `docker compose` com Postgres, Redis, migração, API e worker, pensado para o **Dokploy** (o Traefik do painel faz o HTTPS); numa VPS sem painel, um arquivo extra acrescenta o Caddy. A imagem é construída e publicada pelo GitHub Actions. Backup diário do banco para fora do servidor. Detalhes em [servidor](servidor.md) e [segurança](seguranca.md).

### Por que Hono e SSE (e não WebSocket)

O streaming do chat é só servidor → celular, e isso é SSE, que o Hono tem nativo. O `expo/fetch` lê resposta em streaming. Avisos ("chegou um gasto") vão por push e o app recarrega. O cliente tipado do Hono (`hono/client`) compartilha os tipos com o app.

## O engine (`packages/core`)

Regras que o engine garante, todas com teste:

- **Dinheiro em centavos, inteiro.** Nunca `float`.
- **Fatura**: cada cartão tem dia de fechamento e de vencimento; a compra cai na fatura certa pela data no fuso `America/Sao_Paulo`.
- **Parcelamento**: 1 compra → N parcelas, cada uma na sua fatura. Juros/IOF são lançamentos separados.
- **Gasto do cartão pela fatura, aplicação fora do gasto**: ver [Definições](#definições).
- **Pagamento de fatura não é gasto**: é transferência conta → cartão. Contar como gasto conta tudo duas vezes.
- **Transferência entre contas suas** não é gasto nem receita.
- **Estorno** fica ligado à compra original.
- **Recorrências** (salário, aluguel, assinaturas) e **orçamento por categoria** com projeção do mês.
- **Melhor dia de compra** por cartão.

Modelo de dados mínimo: `accounts`, `cards`, `transactions` (valor em centavos, tipo, categoria, conta ou cartão, `invoiceMonth`, `installmentOf`, `status`), `categories`, `rules`, `budgets`, `recurrences`, `goals`, `agents`, `alerts`, `raw_events`.

## Definições

Os números do app seguem estas definições, todas no engine (`packages/core`) e usadas igual no Início, no relatório, na sugestão de orçamento, nos avisos e nas ferramentas da IA (`monthSummary` do `@orbita/ledger`).

- **Gasto do mês.** O que o dono paga naquele mês. **Cartão: pela fatura**, no mês em que ela vence (`invoiceMonth`), não pela data da compra; cada parcela pesa na sua própria fatura, e o estorno no cartão segue a fatura dele. **Conta (débito, Pix, boleto): pela data** (`budgetMonth`). A fatura aberta pesa no mês em que vence, não antes. Pagamento de fatura e transferência não entram. O conjunto vem de `listForSpendingMonth` e a soma de `summarizeMonth`.
  - Parcela que o banco ainda não lançou, de um grupo de parcelas já visto, **conta na fatura do mês dela como estimada** (`projectedCents`), só de hoje em diante (mês passado fica como foi gravado). Assim a fatura de dezembro já aparece no mês certo antes de o banco fechá-la. A estimada **não entra** se a fatura já fechou (o banco cobrou o que tinha), se a fatura já tem uma parcela de mesmo número, total e valor (mesmo de outro grupo: o banco repete o número no nome e isso fragmentava o grupo) nem em dobro (estimadas iguais viram uma).
  - **De onde veio o número.** `GET /v1/summary/:mês/breakdown` lista cada lançamento que somou ao Gasto (ramo conta, cartão ou estimada, data, fatura, mês do orçamento, tipo, valor, categoria, subtotais); no app, tocar em "Gasto R$ X" no Início abre "Como chegamos nesse número".
- **Investido.** Aplicação: dinheiro que sai da conta para ações, cripto, CDB, caixinha (tipo `investment`). **Não é gasto**: não reduz o "Dá pra gastar", não entra no Gasto, no % do orçamento nem em "Gastos por categoria". Aparece à parte, "Investido R$ X". Rendimento e resgate continuam **receita**. Despesa de conta lançada à mão na categoria Investimentos vira `investment`; no cartão continua despesa.
- **Transferência própria.** Dinheiro entre contas do próprio dono (`transfer`): nem gasto nem receita. Pix para outra pessoa não é isso: é gasto em Transferências.
- **Pagamento de fatura.** Transferência conta → cartão (`card_payment`): não é gasto, porque as compras já pesaram na fatura.
- **Dá pra gastar** (mês atual) = orçamento total do mês − Gasto do mês − recorrências ainda por lançar. Como o cartão pesa pela fatura, a compra feita hoje no cartão reduz o mês em que a fatura vence, não o de hoje; o Investido não entra na conta. A projeção usa o mesmo Gasto, mais as recorrências pendentes, mais o ritmo diário do que sai da conta (a fatura que vence no mês é compromisso fechado e não é estendida pelos dias restantes).

## Ingestão (`packages/ingest`)

O mesmo gasto pode chegar três vezes (notificação na hora, Meu Pluggy no dia seguinte, extrato no fim do mês). O fluxo:

1. **Evento bruto**: toda fonte grava o que chegou, com chave de idempotência. Parser melhorou? Reprocessa.
2. **Normalizador**: vira candidato (valor, data, estabelecimento, conta/cartão).
3. **Conciliador**: procura lançamento existente com mesmo valor, mesma conta, data próxima e nome parecido. Achou → junta. Não achou → cria.
4. **Status amadurece**: notificação cria como `pendente`; o Meu Pluggy confirma (`confirmado`) e é a fonte da verdade.
5. **Dúvida → Revisão**: o que o conciliador ou o parser não tiver certeza vai para a tela _Para revisar_.

Fontes:

- **Notificação (Android)**: `NotificationListenerService` via módulo nativo (exige dev build). Parser por banco com regras; a IA só entra quando o parser não reconhece.
- **Meu Pluggy**: sincronização diária pelo worker. O plano pessoal não lista conexões pela API: o ID de cada conexão é cadastrado uma vez.
- **Comprovante**: compartilhar imagem/PDF com o app; extração com saída estruturada, numa chamada **sem ferramentas** (texto de fora é dado, não instrução).
- **Extrato**: CSV, OFX e PDF de fatura, com tela de revisão antes de gravar.
- **Categorização**: regras primeiro (aprendidas com as correções do usuário); IA só sugere quando não há regra.

## Agentes (`packages/agents`)

- Laço de ferramentas sobre o SDK oficial da Anthropic (escrito à mão, para checar limite e custo a cada volta; ver [arquitetura](arquitetura.md#chat-com-a-ia-packagesagents--moduleschat)); ferramentas definidas com Zod.
- Sonnet 5.5 por padrão e Haiku 5.5 para perguntas curtas só de leitura (trocáveis por variável de ambiente); custo do mês visível em _Configurações → Servidor e chaves_, com limite mensal.
- **Ferramentas de leitura**: lançamentos, resumo do mês, fatura, orçamento, projeção.
- **Ferramentas de escrita**: lançar, recategorizar, aplicar o plano da renda, configurar o app com o histórico (assinaturas, regras de categoria, renda), criar orçamento/meta/alerta. Toda escrita gera um card no chat com **Desfazer**.
- Os avisos são decididos pelo **worker** (determinístico); o agente só escreve o texto em cima dos números prontos.

| Agente          | Papel                                                                      |
| --------------- | -------------------------------------------------------------------------- |
| Órbita          | Principal. Coordena os outros, lança pelo chat, lê comprovantes, responde. |
| Vigia           | Avisa quando um gasto foge do orçamento ou do padrão.                      |
| Fechamento      | Resumo do mês e da semana, comparação com o período anterior.              |
| Metas           | Acompanha metas, avisa atraso, guarda a sobra do mês.                      |
| Caça-assinatura | Acha cobranças que se repetem, renovações e aumentos de preço.             |
| Cofrinho        | Sugere quanto guardar e onde o dinheiro parado renderia mais (só sugere).  |

## Segurança e privacidade

- O app só conversa com o servidor do próprio usuário. Chaves (Anthropic, Meu Pluggy) ficam **só no servidor**, criptografadas.
- Pareamento do aparelho por código de uso único gerado no servidor; token do aparelho no `SecureStore`; desbloqueio com biometria.
- Texto de notificação, comprovante e extrato é **dado não confiável**: nunca vira instrução para os agentes.
- Opcional: expor a API só pela Tailscale.
- Nenhum segredo no repositório; `.env.example` documenta as variáveis sem valor.

## Ordem de construção

1. **Fundação**: monorepo pnpm, `docker compose`, Prisma, pareamento do aparelho.
2. **Engine com testes**: fatura, parcelas, transferências, orçamento.
3. **App básico**: contas, cartões, lançamento manual, Início e Atividades.
4. **Ingestão**: notificações → comprovante e extrato → conciliador → Revisão.
5. **Meu Pluggy**: sincronização diária.
6. **Agentes**: chat com a Órbita, depois Vigia e Fechamento.
7. **Metas, assinaturas e os demais agentes.**

Cada fase entrega algo usável.

## Build e distribuição

APK gerado no **GitHub Actions** (`expo prebuild` + Gradle), sem depender do EAS. Instalação direta no aparelho (sideload).
