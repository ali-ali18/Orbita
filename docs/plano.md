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
- **Gasto pela data da compra, fatura como visão à parte, aplicação fora do gasto**: ver [Definições](#definições).
- **Pagamento de fatura não é gasto**: é transferência conta → cartão. Contar como gasto conta tudo duas vezes.
- **Transferência entre contas suas** não é gasto nem receita.
- **Estorno** fica ligado à compra original.
- **Recorrências** (salário, aluguel, assinaturas) e **orçamento por categoria** com projeção do mês.
- **Melhor dia de compra** por cartão.

Modelo de dados mínimo: `accounts`, `cards`, `transactions` (valor em centavos, tipo, categoria, conta ou cartão, `invoiceMonth`, `installmentOf`, `status`), `categories`, `rules`, `budgets`, `recurrences`, `goals`, `agents`, `alerts`, `raw_events`.

## Definições

Os números do app seguem estas definições, todas no engine (`packages/core`) e usadas igual no Início, no relatório, na sugestão de orçamento, nos avisos e nas ferramentas da IA (`monthSummary` do `@orbita/ledger`).

- **Gasto do mês.** O que o dono gastou naquele mês, **pela data da compra** (competência, `budgetMonth`), na conta e no cartão. Compra no cartão pesa no mês em que foi feita, não no da fatura; cada parcela pesa no seu próprio mês (mês da compra + n − 1); o estorno fica no mês em que acontece. Lançamento pendente conta. Pagamento de fatura (`card_payment`), transferência própria e aplicação não entram. Nada estimado entra: a parcela que o banco ainda não lançou aparece só na visão da fatura e no plano de meses futuros. O conjunto vem de `loadSpendingMonth` (um só, usado no Início, no orçamento, no "Dá pra gastar", no relatório, nos agentes e no plano) e a soma de `summarizeMonth`. **Por quê:** é o que o dono espera ver ("quanto gastei em novembro") e o que outro app de finanças que ele usa mostra; o regime por fatura (versões #44 a #49) fazia o Gasto de novembro misturar compras de outubro e escondia as de novembro que só vencem em dezembro.
  - **De onde veio o número.** `GET /v1/summary/:mês/breakdown` lista cada lançamento que somou ao Gasto (ramo conta ou cartão, com subtotal por cartão; data, fatura, mês do orçamento, tipo, valor, categoria); no app, tocar em "Gasto R$ X" no Início abre "Como chegamos nesse número".
- **Faturas (o que se deve nos cartões).** Outra visão, separada do Gasto: `GET /v1/invoices/overview` (`invoicesOverview` do `@orbita/ledger`; engine: `cardInvoice` e `invoice-payment`). **Fechada** com fatura do banco (`card_bills`, do `/bills`): total = `totalAmountCents` do banco; pago = o maior entre os `payments` da fatura **seguinte** (a doc da Pluggy registra o pagamento da N em `payments` da N+1) e os `card_payment` casados (são o mesmo pagamento visto de dois lados: nunca se somam). **Aberta** (o banco não a manda em `/bills`) e cartão sem fatura do banco: soma dos lançamentos, como antes (é aqui, e só aqui, que a parcela estimada aparece). Cada fatura traz `state` honesto (`paid` | `closed` a vencer | `overdue` | `open`), `source` (`bank` | `ledger`) e `bankSyncedAt`. O **total em faturas** (`owedCents`) é só o que está em aberto ou devido (aberta mais fechadas ainda não pagas, já descontados os pagamentos; fatura paga nunca entra) e o **próximo vencimento** é o da fatura com saldo mais próxima. `history` é a série dos últimos 6 meses (total por mês de fatura, para o gráfico de barras; o último inclui a aberta). No Início, é a carteira de cartões (uma faixa por cartão, na cor do emissor).
- **Limite do cartão.** (Regra de coerência e limite efetivo: ver [pluggy.md](pluggy.md#limite-efetivo-conector-que-não-é-open-finance): quando o dono baixou o limite no banco, o limite mostrado é disponível + saldo e o aprovado vem à parte.) Mesmo endpoint, `limit` por cartão e `limits` somando todos. Com o disponível do banco (`Card.availableCents`): **usado = limite − disponível** (a doc da Pluggy: limite = disponível + saldo em aberto + dívida anterior, então já inclui fatura fechada e parcelas futuras) e disponível = o do banco (`source: "bank"`, com `syncedAt`: mostre a idade). Sem ele (cartão manual ou ainda não lido) cai na estimativa de antes (o que se deve mais as parcelas que caem depois da aberta; `source: "estimated"`), e sem limite cadastrado não há disponível (`source: "none"`, fora dos totais). `usedLimitCents` continua igual a `limit.usedCents`.
- **Saldo em contas.** `GET /v1/accounts/balances` (`accountBalances`): o saldo que o banco informou (`Account.balanceCents`), total, parte de cada conta (%) e a idade da leitura. Conta sem saldo do banco vem marcada (`hasBalance: false`) e fica fora do total: ausente não é zero.
- **Fluxo de caixa.** `GET /v1/cash-flow/:mês` (`cashFlow`): o que entrou e saiu das **contas** (não do cartão) pela data do lançamento. Entradas: receita, estorno em conta, resgate. Saídas: gasto em conta, **pagamento de fatura** (o dinheiro saiu da conta, ao contrário do Gasto), aplicação. Transferência entre contas próprias fica fora dos dois lados.
- **Gasto dia a dia.** `GET /v1/summary/:mês/daily` (`spendingDaily`): acumulado por dia do mês (até hoje) e do anterior (inteiro) para linha e tracejado; o último ponto é exatamente o Gasto do Início (`spendingOfMonth`); a variação compara com o anterior **até o mesmo dia**; top 3 estabelecimentos pelo nome limpo (total e vezes).
- **Parcelamentos.** `GET /v1/installments` conta pela parcela **vista** (n/N), `installmentStanding` no engine: a vigente é a de maior número cuja fatura já chegou; paga = as anteriores a ela (as que o Órbita nunca viu são estimadas pelo valor da primeira vista, `paidEstimated`); falta = da vigente em diante (as futuras que ainda não existem, pelo valor da vigente, `remainingEstimated`); `committedMonthCents` é o que vence no mês e `lastInvoiceMonth` a fatura da última parcela.
- **Investido.** Aplicação: dinheiro que sai da conta para ações, cripto, CDB, caixinha (tipo `investment`). **Não é gasto**: não reduz o "Dá pra gastar", não entra no Gasto, no % do orçamento nem em "Gastos por categoria". Aparece à parte, "Investido R$ X". Só o rendimento é **receita**. O **resgate** (o principal que volta; tipo `redemption`) não é renda nem gasto: abate o "Investido" do mês, até zero. Despesa de conta lançada à mão na categoria Investimentos vira `investment`; no cartão continua despesa.
- **Transferência própria.** Dinheiro entre contas do próprio dono (`transfer`): nem gasto nem receita. Pix para outra pessoa não é isso: é gasto em Transferências. Cada banco do Meu Pluggy é uma conexão separada, então no fim de cada sincronização um passo olha **todas** as conexões: saída de uma conta e entrada de mesmo valor em OUTRA conta sua, no mesmo dia ou no seguinte, viram `transfer` (com o destino) quando o par é único **e** pelo menos uma ponta mostra que é do próprio dono (CPF/CNPJ, nome do titular, categoria "mesma titularidade" ou "entre contas"); valor e dia iguais, sozinhos, não bastam: um Pix real a terceiro continua gasto. O nome também vale, tolerante (sem caixa, sem espaços a mais, sem o prefixo "PIX ENVIADO", "TED", "TRANSF", e cortado no fim se tiver nome e um sobrenome na ordem).
- **Salário.** Entrada (`income`) sem categoria vira a categoria de sistema **Salário** no fim de cada sincronização quando (a) o mesmo pagador (nome normalizado, 3 primeiras palavras) creditou valor parecido (até 10 %) de R$ 1.000 ou mais em pelo menos 2 meses seguidos, a última há até 45 dias, ou (b) o valor está a até 2 % de uma renda mensal cadastrada pelo dono e cai a até 5 dias do dia de pagamento dela (`findSalaryCredits` em `packages/core/src/salary.ts`; gravação em `packages/ingest/src/pluggy/salary.ts`). Nunca mexe em lançamento com `categoryEditedByOwner` nem em entrada que já tem categoria específica. A categoria só rotula a receita: não entra em gasto nem em orçamento.
- **Pagamento de fatura.** Transferência conta → cartão (`card_payment`): não é gasto, porque as compras já pesaram no mês em que foram feitas. O pagamento que sai da conta com texto de fatura de cartão ("Pagamento de fatura Cartão…") vira `card_payment` quando o cartão é conectado e o total da fatura ou o emissor na descrição o identifica; ambíguo fica pendente para revisão e **fora do Gasto** até o dono confirmar (aí vira despesa) ou ligar ao cartão; o cartão é procurado entre os de **todas** as conexões (valor igual ao total ou ao que falta da fatura, dentro de 5 dias do vencimento; emissor ou final do cartão na descrição desempata) e a rodada seguinte reavalia o que ficou em "Fatura de cartão"; sem nenhum cartão que combine é o único rastro daquele gasto e conta na categoria "Fatura de cartão", com a nota "cartão não conectado".
- **Dá pra gastar** (mês atual) = orçamento total do mês − Gasto do mês − recorrências ainda por lançar. A compra feita hoje no cartão já reduz o mês de hoje; o Investido não entra na conta. A projeção usa o mesmo Gasto, mais as recorrências pendentes, mais o ritmo diário do que foi gasto sem ser recorrência.

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
- **Autonomia com níveis** (agente Economia): "Só avisar" (padrão) ou "Agir no que é reversível" (categorizar, cadastrar assinatura detectada, criar limite, marcar duplicata, criar meta de economia). Toda ação autônoma fica no **registro de atividades** com motivo, evidência e Desfazer, com limite por execução. Nunca sozinho: apagar lançamento, mover dinheiro, pagar, mexer em dado do banco ou no que o dono editou. Ver [arquitetura](arquitetura.md#economia-onde-cortar-e-autonomia).

| Agente          | Papel                                                                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Órbita          | Principal. Coordena os outros, lança pelo chat, lê comprovantes, responde.                                                                                   |
| Vigia           | Avisa quando um gasto foge do orçamento ou do padrão.                                                                                                        |
| Fechamento      | Resumo do mês e da semana, comparação com o período anterior.                                                                                                |
| Metas           | Acompanha metas, avisa atraso, guarda a sobra do mês.                                                                                                        |
| Caça-assinatura | Acha cobranças que se repetem, renovações e aumentos de preço.                                                                                               |
| Cofrinho        | Sugere quanto guardar e onde o dinheiro parado renderia mais (só sugere).                                                                                    |
| Economia        | Acha onde cortar custos (assinaturas repetidas, taxas, categoria acima da média…) e, se o dono deixar, age sozinho **só no que tem Desfazer**, com registro. |

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
7. **Metas, assinaturas e os demais agentes**, incluindo o Economia (onde cortar, com autonomia em níveis).

Cada fase entrega algo usável.

## Build e distribuição

APK gerado no **GitHub Actions** (`expo prebuild` + Gradle), sem depender do EAS. Instalação direta no aparelho (sideload).
