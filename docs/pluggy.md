# Meu Pluggy

Como o Órbita sincroniza contas, cartões e lançamentos do Meu Pluggy (plano pessoal gratuito). Código em `packages/ingest/src/pluggy/`, fila em `apps/worker`, rotas em `apps/api/src/modules/pluggy/`.

## O que foi conferido e o que é suposição

`docs.pluggy.ai` está fora da rede permitida da sessão. A conferência foi feita contra o **SDK oficial `pluggy-sdk` 0.94.2** (npm; só lido, nunca executado) e contra uma busca na doc de parcelas. Caminhos abaixo são relativos a `pluggy-sdk/dist/`.

**Confirmado pelo SDK**

| Ponto                                                                                                                                                                                                                                                                                                                                                                        | Onde no SDK                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST {base}/auth` com `{ clientId, clientSecret, nonExpiring: false }` → `{ apiKey }`; as chamadas levam o header `X-API-KEY`. A `apiKey` é um **JWT com `exp`** (o SDK renova quando `exp <= agora`); o Órbita renova 1 min antes do `exp`, com teto de 100 min                                                                                                            | `baseApi.js` (`getApiKey`, `isJwtExpired`, `createGetRequest`)                                                                              |
| Base `https://api.pluggy.ai`                                                                                                                                                                                                                                                                                                                                                 | `baseApi.js`                                                                                                                                |
| `GET /items/{id}` → `Item { id, connector { name… }, status, executionStatus, lastUpdatedAt, error… }`; `status` ∈ `UPDATED`, `UPDATING`, `WAITING_USER_INPUT`, `WAITING_USER_ACTION`, `MERGING`, `LOGIN_ERROR`, `OUTDATED`. O Órbita para com "reconecte" em `LOGIN_ERROR`, `WAITING_USER_INPUT` e `WAITING_USER_ACTION`                                                    | `types/item.d.ts`, `client.js` (`fetchItem`)                                                                                                |
| Listar items é opt-in em plano pago (`GET /v2/items`, 403 `LIST_ITEMS_FEATURE_NOT_ENABLED`): confirma que o `itemId` precisa ser guardado                                                                                                                                                                                                                                    | `client.js` (`fetchItemsCursor`)                                                                                                            |
| `GET /accounts?itemId=` → página `{ results, page, total, totalPages }`. `Account { id, itemId, type ∈ BANK/CREDIT, subtype ∈ SAVINGS_ACCOUNT/CHECKING_ACCOUNT/CREDIT_CARD, number, name, marketingName, owner, taxNumber, currencyCode, bankData, creditData }`                                                                                                             | `types/account.d.ts`, `types/common.d.ts`, `client.js` (`fetchAccounts`)                                                                    |
| `creditData.balanceCloseDate` / `balanceDueDate` (**data** da fatura atual, `Date \| null`), `creditLimit`, `availableCreditLimit` (números). Não existe "dia de fechamento" numérico: o Órbita usa o dia dessas datas                                                                                                                                                       | `types/account.d.ts` (`CreditData`)                                                                                                         |
| Transação: `id`, `accountId`, `date`, `description`, `descriptionRaw`, `type ∈ DEBIT/CREDIT` ("DEBIT: dinheiro saindo; CREDIT: entrando"), `amount` e `amountInAccountCurrency` (números), `currencyCode`, `category`, `categoryId`, `status` opcional (`PENDING`/`POSTED`, padrão `POSTED`), `operationType` (texto livre), `paymentData`, `creditCardMetadata`, `merchant` | `types/transaction.d.ts`                                                                                                                    |
| `creditCardMetadata`: `installmentNumber`, `totalInstallments`, `totalAmount`, `purchaseDate`, `billId`, `cardNumber`, `billPostDate`… (sem id de grupo)                                                                                                                                                                                                                     | `types/transaction.d.ts`                                                                                                                    |
| `paymentData.payer` / `receiver` com `documentNumber { value, type CPF/CNPJ }`, `name`, conta e agência: serve para saber se a outra ponta de um Pix/TED é o próprio titular                                                                                                                                                                                                 | `types/transaction.d.ts` (`TransactionPaymentData`)                                                                                         |
| **`GET /transactions` por página está marcado `@deprecated`**; o recomendado é `GET /v2/transactions` com `accountId`, `dateFrom`, `dateTo`, `after` (cursor) → `{ results, next }`, onde `next` é um link com `?after=`. O Órbita usa o v2                                                                                                                                  | `client.js` (`fetchTransactions`, `fetchTransactionsCursor`, `fetchAllTransactions`), `types/transaction.d.ts` (`TransactionCursorFilters`) |
| Paginação por página (accounts, bills): parâmetros `page`, `pageSize` (padrão 20, máx. 500)                                                                                                                                                                                                                                                                                  | `types/common.d.ts` (`PageFilters`, `PageResponse`)                                                                                         |
| `GET /bills?accountId=` → `CreditCardBills { id, dueDate, billClosingDate, totalAmount, payments[] { id, valueType, paymentDate, paymentMode, amount, currencyCode } }`. O Órbita usa `payments` para casar o pagamento da fatura com o débito da conta                                                                                                                      | `types/creditCardBills.d.ts`, `client.js` (`fetchCreditCardBills`)                                                                          |
| Transações dos últimos 7 dias do cartão chegam `PENDING` e sem `billId`; parcelas: o Open Finance não devolve id de grupo                                                                                                                                                                                                                                                    | [doc de parcelas](https://docs.pluggy.ai/pt/docs/products/credit-card-installments) (busca)                                                 |
| Campos de data são desserializados pelo SDK só se têm o formato exato `YYYY-MM-DDTHH:mm:ss.sssZ`; outras formas ficam texto                                                                                                                                                                                                                                                  | `transforms.js`                                                                                                                             |

**Detecção de pagamento de fatura e de transferência própria.** O SDK **não** expõe `categoryId` fixo, enum de `operationType` (é `string | null` livre) nem lista de categorias (`types/category.d.ts` só tem `id`/`description`). Por isso o Órbita usa, nesta ordem, sinais estruturais:

1. Pagamento de fatura: débito na conta com mesmo valor (e até 3 dias de diferença) de um `payments[]` de `/bills` → `card_payment` ligado ao cartão daquela fatura (funciona com vários cartões). O crédito de mesmo valor no cartão não é estorno.
2. Transferência própria: `paymentData.payer` e `receiver` com o mesmo CPF/CNPJ, ou a outra ponta igual ao `taxNumber` da conta.
3. Só se nada acima serve: nome da categoria (suposição) — pagamento de fatura com um único cartão na conexão.

**Ainda suposição (o SDK não diz)**

| Ponto                                                                 | Observação                                                                                                        |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `date` da transação vem como meia-noite UTC (um dia, não um instante) | O SDK só tipa como `Date`. Tratado nos dois casos (meia-noite UTC vale como o dia; outro instante vira São Paulo) |
| A `apiKey` dura ~2 h                                                  | O SDK só lê o `exp` do JWT; a duração não aparece                                                                 |
| Nomes das categorias ("Credit card payment", "Same person transfer"…) | Plano B; lista em `mapping.ts`                                                                                    |
| `GET /bills` existe para o conector do dono                           | Só Open Finance, segundo os tipos; erro nesse endpoint é ignorado e vale o plano B                                |
| `GET /v2/transactions` não aceita `pageSize`                          | Ausente em `TransactionCursorFilters`; o Órbita não envia                                                         |
| O sinal de `amount` varia entre conta e cartão                        | Por isso o Órbita usa `type` e o valor absoluto                                                                   |

## Fluxo

1. O dono cola Client ID e Client Secret em **Servidor e chaves** (cofre) e o `itemId` de cada conexão (`POST /v1/pluggy/connections`).
2. O worker roda `syncPluggy` todo dia às 06:00 (America/Sao_Paulo) e quando o app chama `POST /v1/pluggy/sync`.
3. Para cada conexão: `GET /items/{id}` (se o banco pediu reconexão, para com erro claro) → `GET /accounts` → por conta, `GET /v2/transactions` na janela (e `GET /bills` para os cartões) → `upsertByExternal("pluggy", id)`.

**Janela:** primeira vez, 90 dias; depois, desde a última sincronização boa menos 7 dias (o Pluggy efetiva lançamentos com atraso). `lastSyncAt` só avança quando a conexão termina `ok`; `partial` e `error` repetem a janela.

**Idempotência:** conta e cartão ligados por `(source "pluggy", externalId)`; lançamento por `upsertByExternal`. Rodar duas vezes não duplica nem sobrescreve. O que o dono apagou não volta; conta/cartão arquivados são pulados.

**Sem chaves:** `no_keys` em cada conexão, nenhuma chamada ao Pluggy, nenhum erro (não entra em laço de falha). Chaves que não abrem (APP_SECRET trocado) viram erro claro.

## Mapeamento

| Pluggy                              | Órbita                                                                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| conta `BANK`                        | `Account` (`checking`, ou `savings` se `SAVINGS_ACCOUNT`)                                                                                                    |
| conta `CREDIT`                      | `Card` com fechamento/vencimento (dia de `balanceCloseDate`/`balanceDueDate`) e limite; o dono pode ajustar os dias depois, o sync só mantém o limite em dia |
| `DEBIT` na conta                    | `expense`                                                                                                                                                    |
| `CREDIT` na conta                   | `income`                                                                                                                                                     |
| `DEBIT` no cartão                   | `expense` com `invoiceMonth` de `invoiceFor` (engine)                                                                                                        |
| `CREDIT` no cartão                  | pagamento recebido: ignorado; senão `refund` ligado à compra original                                                                                        |
| pagamento de fatura pela conta      | `card_payment` (não é gasto) — só se a conexão tem **um** cartão                                                                                             |
| transferência entre contas próprias | ignorada (não é gasto nem receita)                                                                                                                           |
| `PENDING`                           | ignorado até efetivar (o id pode mudar)                                                                                                                      |
| moeda ≠ BRL                         | usa `amountInAccountCurrency` se vier; senão ignora                                                                                                          |

**Dinheiro:** o `amount` do Pluggy é float. `decimalToCents` (em `@orbita/core`) converte via texto com 6 casas e arredonda meio centavo para longe do zero (`0.1 + 0.2` → 30). Nunca `amount * 100`.

**Datas:** meia-noite UTC vale como o dia daquela data (converter para São Paulo recuaria um dia). Qualquer outro instante é convertido para America/Sao_Paulo.

**Estorno** exige a compra original gravada (mesmo cartão, valor e descrição, nas faturas dos últimos 3 meses). Sem ela, fica de fora e é tentado de novo na próxima rodada (`refund_without_original` no resultado).

## Limitações conhecidas (para a Fase 6 ou depois)

- **Parcelas** entram como lançamentos simples ("Parcela 3/10" na observação). O Pluggy manda uma parcela por fatura, sem id de grupo; casar com `createInstallmentGroup` exigiria heurística (descrição + valor + total).
- **`pending` ↔ Pluggy:** o Pluggy não casa com o lançamento que a notificação criou como `pending`; os dois coexistem até o conciliador da Fase 6.
- **Pagamento de fatura** sem fatura correspondente em `/bills` e com 2+ cartões na conexão é ignorado (`card_payment_unlinked`).
- Sem categorização (`categoryId` nulo): vem das regras da Fase 6.
- Remover uma conexão só para de sincronizar; contas e lançamentos importados ficam.
- Cartão sem datas de fatura no `creditData` é ignorado, com aviso nas notas do resultado.
- Lançamentos de moeda estrangeira sem valor convertido são ignorados.

## Rotas (todas exigem `Authorization: Bearer`)

- `GET /v1/pluggy/connections` → `{ connections }`
- `POST /v1/pluggy/connections` `{ itemId, label? }` → 201 `{ connection }` (409 se repetida; com chaves cadastradas confere no Pluggy: 422 `conexao_invalida` se o ID não existe ou é de outra conta)
- `DELETE /v1/pluggy/connections/:id` → `{ connection }` (404 se não existe)
- `POST /v1/pluggy/sync` → 202 `{ sync: "queued" | "running" }` (400 `sem_conexoes`/`sem_chaves`; 503 sem Redis). Enfileira no worker com `jobId` fixo: pedidos repetidos viram um só e nunca rodam em paralelo com o diário.
- `GET /v1/pluggy/status` → `{ keysConfigured, sync, lastSyncAt, connections }`

A API precisa de `REDIS_URL` (o compose já passa) para enfileirar; sem ele as demais rotas funcionam.
