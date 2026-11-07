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

1. Pagamento de fatura: cada `payments[]` de `/bills` casa com **um** débito da conta (mesmo valor, até 3 dias de diferença; prefere o mesmo dia, depois o mais próximo; o pagamento é consumido) → `card_payment` ligado ao cartão daquela fatura, com qualquer número de cartões. Um aluguel de mesmo valor dois dias depois continua gasto. No cartão vale o mesmo: o crédito casado é o pagamento (ignorado) e um estorno real de mesmo valor continua estorno.
2. Transferência própria: `paymentData.payer` e `receiver` com o mesmo CPF/CNPJ, ou a outra ponta igual ao `taxNumber` da conta.
3. Só se nada acima serve: nome da categoria (suposição), e **só liga a um cartão se o valor bate com o total (`totalAmount`) de uma fatura de um único cartão** da conexão. Senão o lançamento fica de fora (`card_payment_unlinked`, com aviso): o Órbita não tem "pagamento de fatura sem cartão" (`card_payment` exige conta e cartão), então ignorar é mais honesto que inventar um cartão ou contar como gasto.

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

1. O dono cola Client ID e Client Secret em **Servidor e chaves** (cofre) e conecta cada banco com **Conectar banco** (Pluggy Connect, abaixo). Colar o `itemId` à mão (`POST /v1/pluggy/connections`) continua possível ("Já tenho o ID da conexão").
2. O worker roda `syncPluggy` todo dia às 06:00 (America/Sao_Paulo) e quando o app chama `POST /v1/pluggy/sync`.
3. Para cada conexão: `GET /items/{id}` (se o banco pediu reconexão, para com erro claro) → `GET /accounts` → por conta, `GET /v2/transactions` na janela (e `GET /bills` para os cartões) → `upsertByExternal("pluggy", id)`.

**Janela:** primeira vez, 90 dias; depois, desde a última sincronização boa menos **40 dias**. Lançamento de cartão pode levar semanas para efetivar (entra com a data da compra); a gravação é idempotente, então a folga só custa uma consulta maior. `lastSyncAt` só avança quando a conexão termina `ok`. Ficam `partial` (e repetem a janela): item que não está `UPDATED` (banco atrasado: `UPDATING`, `OUTDATED`…, nota "o banco não atualizou"), falha nas faturas e conta que não sincronizou.

**Idempotência:** conta e cartão ligados por `(source "pluggy", externalId)`; lançamento por `upsertByExternal`. Rodar duas vezes não duplica nem sobrescreve. O que o dono apagou não volta; conta/cartão arquivados são pulados.

**Sem chaves:** `no_keys` em cada conexão, nenhuma chamada ao Pluggy, nenhum erro (não entra em laço de falha). Chaves que não abrem (APP_SECRET trocado) viram erro claro.

## Mapeamento

| Pluggy                              | Órbita                                                                                                                                                                            |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| conta `BANK`                        | `Account` (`checking`, ou `savings` se `SAVINGS_ACCOUNT`)                                                                                                                         |
| conta `CREDIT`                      | `Card` com fechamento/vencimento (ver "Datas do cartão") e limite; o dono pode ajustar os dias depois, o sync só mantém o limite em dia                                           |
| `DEBIT` na conta                    | `expense`                                                                                                                                                                         |
| `CREDIT` na conta                   | `income`                                                                                                                                                                          |
| `DEBIT` no cartão                   | `expense`; `invoiceMonth` = mês do vencimento da fatura indicada por `creditCardMetadata.billId` (quando `/bills` a traz); sem isso, `invoiceFor` (engine) pelo dia de fechamento |
| `CREDIT` no cartão                  | pagamento recebido: ignorado; senão `refund` ligado à compra original                                                                                                             |
| pagamento de fatura pela conta      | `card_payment` (não é gasto) — só se a conexão tem **um** cartão                                                                                                                  |
| transferência entre contas próprias | ignorada (não é gasto nem receita)                                                                                                                                                |
| `PENDING`                           | ignorado até efetivar (o id pode mudar)                                                                                                                                           |
| moeda ≠ BRL                         | usa `amountInAccountCurrency` se vier; senão ignora                                                                                                                               |

**Dinheiro:** o `amount` do Pluggy é float. `decimalToCents` (em `@orbita/core`) converte via texto com 6 casas e arredonda meio centavo para longe do zero (`0.1 + 0.2` → 30). Nunca `amount * 100`.

**Datas:** meia-noite UTC vale como o dia daquela data (converter para São Paulo recuaria um dia). Qualquer outro instante é convertido para America/Sao_Paulo.

**Estorno** exige a compra original gravada (mesmo cartão, valor e descrição, nas faturas dos últimos 3 meses). Sem ela, fica de fora e é tentado de novo na próxima rodada (`refund_without_original` no resultado).

## Limitações conhecidas (para a Fase 6 ou depois)

- **Parcelas** viram parcelamento de verdade (ver "Parcelamentos"), desde que o Pluggy mande a data da compra; sem ela entram como lançamentos simples ("Parcela 3/10" na observação).
- **`pending` ↔ Pluggy:** o Pluggy não casa com o lançamento que a notificação criou como `pending`; os dois coexistem até o conciliador da Fase 6.
- **Pagamento de fatura** que não casa com `/bills` nem tem total de fatura igual é ignorado (`card_payment_unlinked`), com aviso nas notas.
- **Falha em `/bills`** (que não seja 404/403 = conector sem faturas) deixa a conexão `partial` e tira da rodada os débitos da conta e os créditos do cartão (`bills_unavailable`): como o `upsertByExternal` nunca corrige um lançamento já gravado, gravar agora um pagamento de fatura como gasto o deixaria errado para sempre. Entram na rodada seguinte.
- **Reclassificar lançamento já importado** (ex.: `expense` → `card_payment` quando as faturas passam a casar) **não foi feito**: o store não guarda "editado pelo dono" (só `updatedAt`, que também muda por automação), então não dá para saber com segurança se o dono mexeu. Fica como pendência; o caminho seguro é o descrito acima (não gravar na dúvida).
- **Linha fora do formato** em `/v2/transactions` é descartada e contada nas notas ("N lançamento(s) vieram fora do formato"), sem derrubar a página nem logar o conteúdo; a conexão segue `ok` (se virasse `partial`, uma linha ruim permanente travaria a janela).
- A categoria do Órbita vem, nesta ordem, de regra do dono → MCC → CNAE → categoria do Pluggy → Outros (ver "Categoria do banco, MCC e regras do dono"). As tabelas de MCC, CNAE e nomes do Pluggy são conhecimento geral, **não** conferidas contra os dados reais do dono: a nota "Outros: …" do sync existe para ajustá-las.
- Remover uma conexão só para de sincronizar; contas e lançamentos importados ficam.
- Cartão sem datas no `creditData` **não é mais ignorado** (ver "Datas do cartão"). Limitação: a marca "datas estimadas" vive só nas notas do resultado da sincronização (não há coluna no cartão nem aviso no app); o dono confere os dias em Cartões. Um cartão criado com datas estimadas não é corrigido sozinho depois (o dono pode ter ajustado à mão).
- Investimento fica de fora (não há conta de investimento no Órbita); ver "Classificação".
- Lançamentos de moeda estrangeira sem valor convertido são ignorados.

## Datas do cartão

O `creditData.balanceCloseDate`/`balanceDueDate` costuma vir nulo no MeuPluggy; antes o cartão era descartado e nenhuma compra entrava. Agora `resolveCardDates` (função pura em `mapping.ts`) escolhe, nesta ordem:

1. `creditData` com as duas datas (dia de cada uma);
2. a fatura mais recente de `GET /bills` que tem `billClosingDate` e `dueDate`;
3. só o vencimento (do `creditData` ou da fatura mais recente): **fechamento = vencimento − 7 dias** (o usual no Brasil é 6 a 10; estimado);
4. nada: cartão criado mesmo assim, fecha dia **20** e vence dia **27** (estimado).

Os casos 3 e 4 geram uma nota no resultado da sincronização ("datas estimadas... Confira em Cartões"). Se `/bills` **falhou de verdade** (não 404/403) e as datas viriam estimadas, o cartão **não é criado** nessa rodada (nota + conexão `partial`): criar fixaria dias chutados, e o sync nunca os corrige. Os lançamentos do cartão continuam usando `creditCardMetadata.billId` → mês do vencimento da fatura quando `/bills` a traz, e `invoiceFor` caso contrário.

## Classificação (investimento, transferência, categoria)

`classify.ts` (puro). A árvore vem de `GET /categories` (uma vez por rodada, validada por Zod; se falhar, a rodada segue só com o nome da categoria do lançamento e anota). A "cadeia" de um lançamento é o nome da categoria dele e dos ancestrais (`parentId`/`parentDescription`), sem acento e minúsculo. Decisão por trechos do nome, nunca por id fixo.

| Família                                                                                                  | O que o Órbita faz                                                                 |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Pagamento de fatura (`credit card payment`, `pagamento de fatura`…)                                      | Como antes: casa com `/bills`; plano B pelo total                                  |
| Mesma titularidade (`same person`, `mesma titularidade`…)                                                | Ignorada (`own_transfer`), junto da detecção por CPF/CNPJ que já existia           |
| Investimento (`investment`, `renda fixa`, `fixed income`, `previdência`, `poupança`, `caixinha`, `cdb`…) | **Ignorado** (`investment`): aplicação e resgate só mudam o dinheiro de bolso      |
| Rendimento (`rendimento`, `dividend`, `interests on investments`…), só entrada                           | **Receita** (`income`, sem categoria)                                              |
| Demais                                                                                                   | Despesa na categoria do Órbita pela tabela abaixo; sem correspondência, **Outros** |

**Por que "ignorar" e não "transferência":** o tipo `transfer` do engine exige conta de origem **e** de destino do próprio dono, e o Órbita não tem conta de investimento. Gravar uma ponta só quebra a invariante; inventar a conta de destino criaria saldo falso. Ignorar é igual ao que já se faz com a transferência própria. **Por que rendimento é receita:** é dinheiro novo (o principal que volta num resgate não é), e entra no "Receita do mês" sem tocar o gasto. Um rendimento que o banco descreve como "resgate" fica de fora (conservador).

**Plano B pela descrição** (só em conta corrente e só com categoria ausente ou genérica "other/outros"): palavras inteiras `aplicação`, `resgate`, `caixinha`, `cdb`, `rdb`, `lci`, `lca`, `poupança`, `tesouro direto`, `dinheiro guardado` → investimento; `rendimento(s)` em entrada → rendimento.

**Tabela de categorias** (primeira que bate, folha antes do pai; ordem: Mercado, Delivery, Transporte, Assinaturas, Saúde, Moradia, Lazer): Mercado (`grocer`, `supermarket`, `mercado`…), Delivery (`eating out`, `restaurant`, `delivery`, `bakery`…), Transporte (`transport`, `taxi`, `fuel`, `gas station`, `parking`, `toll`, `vehicle`…), Assinaturas (`digital service`, `subscription`, `streaming`, `software`…), Saúde (`health`, `pharmac`, `medic`, `dental`…), Moradia (`housing`, `rent`, `utilities`, `electric`, `water`, `internet`, `telecom`…), Lazer (`entertainment`, `leisure`, `travel`, `hotel`, `game`, `sport`…). Vale também para compra e estorno no cartão.

**Suposição:** os nomes das categorias do Pluggy não vêm no SDK (só `id`, `description`, `parentId`, `parentDescription`). A tabela foi escrita de memória em inglês e português e deve ser revisada contra o `GET /categories` real do dono; o `categoryId` só serve para subir pela árvore. Lançamento classificado errado é corrigido com "Reimportar do zero" depois de ajustar a tabela.

## Categoria do banco, MCC e regras do dono

**O que se guarda.** Todo lançamento importado grava `source_category` (a cadeia legível da categoria do Pluggy, da raiz para a folha: `Transfers › Transfer - PIX`; sem a árvore, só o texto do lançamento; no máximo 120 letras, sem caracteres de controle), `merchant_name` (`merchant.name`, senão `merchant.businessName`) e `category_edited_by_owner` (falso). O DTO do lançamento expõe `sourceCategory`, `merchantName` e `categoryEditedByOwner`. Servem para ver o que o banco disse e ajustar as tabelas; **não decidem nada sozinhas**.

**Ordem da categoria de uma despesa/estorno** (`chooseCategory` em `mapping.ts`):

1. **Regra do dono** (`category_rules`): o padrão aparece, como palavras inteiras, no nome do estabelecimento do banco ou na descrição normalizada. Com duas regras casando, vence a de padrão mais longo (mais específica).
2. **MCC** (`creditCardMetadata.payeeMCC`, `mcc.ts`): 5411/5499 mercado; 5812/5814 restaurante e fast food; 4111/4121/5541/5542 transporte e combustível; 4899/5815/5817/5818 assinaturas e mídia digital; 7832/7922/7996 e as faixas 3000-3299 (aéreas) e 3500-3999 (hotéis) lazer e viagem; 5912/8011/8021/8062 saúde; 6513/4900 moradia. Códigos ambíguos (loja de departamento, "serviços diversos") ficam de fora.
3. **CNAE** (`merchant.cnae`, 4 primeiros dígitos): supermercado 4711, restaurante 5611, farmácia 4771, posto 4731, hotel 5510…
4. **Categoria do Pluggy** (tabela por nome da cadeia, ver "Classificação").
5. **Outros**.

Nenhuma dessas tabelas foi conferida contra dados reais. `Outros` é sempre a rede de segurança, nunca descarte.

**Diagnóstico.** Cada conexão registra nas `notes` do resultado uma linha como `Outros: Transfer - PIX ×12, Shopping ×3` (até 8 categorias do banco, depois `, mais N`): só a categoria do banco e a contagem das despesas **novas** que caíram em Outros sem pista; nunca descrição, valor nem nome de estabelecimento.

**Regras aprendidas.** `category_rules (id, pattern UNIQUE, category_id, created_at)`; `pattern` é o "nome do estabelecimento" normalizado por `normalizeMerchantName` (`packages/shared/src/category-rules.ts`): minúsculo, sem acento, sem data, sem parcela (`3/10`, `parcela 3 de 10`), sem prefixo de banco (`pix enviado -`, `compra no debito`, `pagamento`, `ted`, `qr code`…, empilhados também), sem número com 3+ dígitos nem código misto; 3 a 60 letras. `Pix enviado - Rei Dos Lanches 12/11` → `rei dos lanches`. No máximo 1000 regras.

- `GET /v1/category-rules` → `{ rules: [{ id, pattern, categoryId, createdAt }] }`
- `POST /v1/category-rules` `{ transactionId, categoryId, applyToExisting? }` → 201 `{ rule, updated }`. O padrão sai do `merchantName` (senão da descrição) do lançamento; padrão já existente troca a categoria da regra. O lançamento de origem recebe a categoria e a marca `categoryEditedByOwner`. Com `applyToExisting`, reclassifica os **outros** lançamentos de consumo (despesa/estorno) que casam **e** cuja categoria o dono não editou; a reclassificação por regra **não** liga a marca. `updated` = quantos mudaram (sem contar o de origem). Erros: 404 lançamento inexistente, 400 sem nome de estabelecimento aproveitável, 422 categoria inexistente/arquivada.
- `DELETE /v1/category-rules/:id` → `{ deleted: true }` (404 se não existe). Apagar a regra **não** desfaz as categorias já aplicadas.

**`categoryEditedByOwner`.** O `PATCH /v1/transactions/:id` com `categoryId` diferente do atual liga a marca. O sync nunca muda categoria de lançamento já gravado (`upsertByExternal` é idempotente). A regra é aplicada pelo sync aos lançamentos **novos** (depois da regra, vale o resto da ordem acima).

**Reimportar.** O reimport apaga e recria os lançamentos do Pluggy: a categoria que o dono trocou à mão **se perde** (a marca vai junto), e as regras reaplicam sozinhas. Por isso o caminho recomendado ao corrigir uma categoria é criar a regra (POST), não só o PATCH.

## Parcelamentos

O Pluggy manda uma parcela por fatura, cada uma com id próprio, e **as parcelas futuras ainda não existem**. Cada parcela de cartão (`DEBIT`) com `creditCardMetadata.installmentNumber`, `totalInstallments` (2 a 72, número dentro do total) e `purchaseDate` entra num **grupo** do Órbita (`installment_group_id`):

- **Id do grupo determinístico**: `pluggy-` + SHA-256 de `[cartão, data da compra, total de parcelas, descrição normalizada sem "3/10", "Parcela 3/10" nem "PARC"]`, 40 hex. Qualquer sincronização (e o reimport) chega ao mesmo id; nada de tabela auxiliar. O valor da parcela e o `totalAmount` do SDK ficam **fora** da chave (a primeira parcela leva o resto dos centavos; o SDK descreve `totalAmount` de forma ambígua).
- `upsertInstallmentByExternal` (novo no `TransactionStore`): a primeira parcela vista cria o grupo, as seguintes entram nele, idempotente por `externalId`. **Grupo parcial**: o modelo passou a aceitar um grupo com menos de N parcelas existentes (a invariante de banco/shared só exige grupo + número + total coerentes; a unicidade `(grupo, número)` já existia). Escolhido em vez de criar as parcelas futuras como "previstas" porque isso exigiria um estado novo (parcela sem id externo trocada pela real), distorceria projeção e fatura, e a troca/duplicata seria frágil.
- Cada parcela leva a **data da compra** e `budget_month` = mês da compra + (n − 1), como nas parcelas lançadas à mão: o gasto do mês é a parcela do mês, nunca a compra inteira. A fatura continua vindo do `billId` (ou do fechamento).
- `GET /v1/installments`: para grupo parcial, as parcelas depois da última vista contam em `remainingCount`/`remainingCents` (e em `totalCents`) **pelo valor da última parcela vista** (estimativa; a real substitui quando chega). As anteriores à primeira vista (compra antes da janela de 90 dias) não são estimadas. Ex.: parcela 3 de 6 vista e 2 paga → "3 de 6, faltam 4 · R$ 1.000,00".
- **Colisão**: duas compras idênticas (mesmo cartão, dia, loja e total de parcelas) têm o mesmo grupo; a segunda parcela de mesmo número viraria duplicata. Ela é gravada **avulsa** com a nota "Parcela n/N" (nenhum gasto se perde) e a conexão avisa na nota "Duas compras parceladas iguais… viraram parcelas avulsas".
- **Sem `purchaseDate`**, parcela de 1x, número fora do total ou total acima de 72: lançamento simples, como antes.
- Lançamentos de parcelas importados **antes** desta mudança continuam avulsos até o próximo reimport (o sync não corrige o que já gravou).

## Nome do cartão

O cartão do Pluggy muitas vezes chega só com "G" ou com bandeira/nível ("Mastercard Gold"). `detectBankName` acha o banco: conector (se não for "MeuPluggy"), senão o banco citado em alguma conta da conexão ("Conta Corrente Inter" → Inter; o banco citado no próprio cartão vale mais), senão o primeiro nome do rótulo da conexão (se não parecer nome de conta). `cardDisplayName`: nome **fraco** (≤ 2 letras ou só bandeira/nível) vira o nome do banco ("Nubank", o app mostra "Nubank •••• 9697"); nome bom que não cita o banco ganha o prefixo ("Nubank Ultravioleta"); sem banco detectado, fica como veio. O sync também troca o nome de um cartão **já existente** se o nome atual é fraco e o novo não é (nome bom que o dono escolheu nunca é mexido).

## Reimportar do zero

`POST /v1/pluggy/reimport` (Bearer) → 202 `{ deleted, sync }`. Serve para limpar o que entrou errado antes da classificação.

1. Antes de qualquer efeito, recusa: 503 sem fila, 400 `sem_conexoes`/`sem_chaves`, 409 `sincronizando` (uma sincronização em curso gravaria a data de agora por cima do zero).
2. `pluggyConnections.resetSyncWindow()`: `lastSyncAt` de todas as conexões volta a `null` (a próxima rodada busca os 90 dias).
3. `transactions.hardDeleteBySource("pluggy")`, numa transação: apaga **de verdade** todos os lançamentos com `source "pluggy"`, os já apagados pelo dono inclusive (voltam, porque o `externalId` fica livre), os estornos deles (de qualquer origem) e as ligações com recorrências (as recorrências em si ficam).
4. Enfileira a sincronização.

Contas e cartões do Pluggy ficam e são reaproveitados pelo `externalId`; lançamentos manuais ficam. A ordem 2 → 3 é de propósito: se algo falhar no meio, o pior caso é buscar de novo (idempotente). No app: Bancos e cartões → "Reimportar do zero", com confirmação na gaveta explicando o que some.

## Conectar banco (Pluggy Connect)

O plano pessoal não mostra o ID da conexão no meu.pluggy.ai e não lista items pela API (403 `LIST_ITEMS_FEATURE_NOT_ENABLED`). O caminho oficial é abrir o widget **Pluggy Connect** e guardar o `itemId` que ele entrega no `onSuccess`. Sem módulo nativo novo (o APK já está instalado; tudo chega por OTA), o widget roda numa **página web do próprio servidor**, aberta no navegador do celular com `Linking.openURL`.

**Fluxo**

1. App: `POST /v1/pluggy/connect-sessions` (Bearer do aparelho). O servidor cria um token aleatório de 32 bytes (guarda só o SHA-256, o aparelho que pediu e a hora; vale 15 min; uso único; uma sessão ativa por vez, garantido por lock no banco) e devolve `{ path: "/pluggy/conectar#s=<token>", expiresAt }`. O app monta a URL com o endereço do servidor pareado (recusa caminho que saia dele) e abre no navegador.
2. Página `GET /pluggy/conectar` (HTML estático, pt-BR, tema escuro dos tokens) + `GET /pluggy/conectar/app.<hash>.js` (o widget). O JS lê o token do fragmento e o apaga do histórico (`history.replaceState`).
3. `POST /pluggy/connect-token {session}`: o servidor confere a sessão (sem gastar) e que o aparelho que a pediu não foi revogado, chama `POST /connect_token` no Pluggy com as chaves do cofre e `clientUserId: "orbita"`, e devolve **só** `{ connectToken }`. O widget abre (`includeSandbox: false`, `language: "pt"`, `theme: "dark"`).
4. `onSuccess({ item })`: a página manda `POST /pluggy/connect-complete {session, itemId}` com `item.id`. O servidor: confere a sessão e o aparelho; confere `GET /items/{id}` com as nossas chaves e recusa (422, sem gastar a sessão) item que não existe na nossa aplicação (404/403 no Pluggy), conector de teste (`connector.isSandbox`) e item criado antes de `sessão − 2 min` (`item.createdAt`; a folga cobre diferença de relógio); gasta a sessão (atômico, uso único); cadastra a conexão (nome do banco como rótulo; idempotente se já existe) e, se o cadastro falhar, **devolve** a sessão (`release`) para tentar de novo; enfileira a sincronização.
5. A página mostra "Pronto!" e um botão para `orbita://configuracoes/bancos` (scheme do `app.json`). O app, ao voltar para o primeiro plano, recarrega o status e a lista.

`onError` (credencial inválida, MFA que falhou) não fecha nada: o widget segue aberto para tentar de novo; se a pessoa o fechar, a página mostra o motivo e "Tentar de novo".

**O widget (`pluggy-connect-sdk` 2.15.0, MIT, uso sem React)**: o pacote npm traz só módulos (sem bundle de navegador; esse mora no CDN do Pluggy). O empacotamento acontece no **build**: `pnpm --filter @orbita/api build:connect` junta `client/main.ts` + SDK + `zoid` com o `esbuild` e grava `apps/api/connect-dist/app.<8 hex>.js` + `manifest.json` (fora do git). O Dockerfile roda esse passo na imagem; em desenvolvimento o `predev` roda. O servidor só **lê e serve** o arquivo (`immutable`, hash no nome) e nunca monta nada em tempo de execução; se o arquivo faltar, lembra a falha por 10 min em vez de reler o disco a cada pedido. Nada vem de CDN. `esbuild` e `pluggy-connect-sdk` são `devDependencies` do pacote api. (A imagem não faz prune de dev: as dependências continuam instaladas nela, mas só o build as usa.)

Se o arquivo faltar, `GET /pluggy/conectar` **continua respondendo 200** com uma página de aviso e só carrega `/pluggy/conectar/limpar.js` (uma linha fixa que tira o token do endereço).

**O que o widget exige (lido no código do pacote; nunca executado fora do build)**

- O widget é um **iframe** de `https://connect.pluggy.ai` (`CONNECT_PRODUCTION_URL`), montado pelo `zoid`; o SDK só aceita mensagens vindas dessa origem. Daí `frame-src https://connect.pluggy.ai`.
- O SDK injeta `<style>` por `innerHTML` (modal e carregando) sem nonce: `style-src 'unsafe-inline'`.
- Nenhum `eval`/`new Function` no bundle (conferido por teste); nenhum `fetch`/XHR do lado da página. As referências a `api.pluggy.ai` são do caminho Cordova e não rodam no navegador.
- OAuth/Open Finance abre janelas: por isso a página **não** manda `Cross-Origin-Opener-Policy` (`same-origin` cortaria a ligação).

**Cabeçalhos finais de `/pluggy/*`**

```
Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src https://connect.pluggy.ai; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'
Referrer-Policy: no-referrer
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Cache-Control: no-store            (o .js: public, max-age=31536000, immutable)
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
```

**Confirmado vs. suposição (esta etapa)**

| Ponto                                                                                                       | Situação                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /connect_token` `{ options: { clientUserId } }` → `{ accessToken }`                                   | Confirmado no `pluggy-sdk` 0.94.2 (`createConnectToken`)                                                                                            |
| `onSuccess({ item })` traz `item.id`; `includeSandbox`, `onError`, `onClose`; iframe de `connect.pluggy.ai` | Confirmado no código e no README do `pluggy-connect-sdk` 2.15.0                                                                                     |
| Esse guia (servidor cria o token, front abre o widget, ID no `onSuccess`)                                   | Confirmado também no guia do dashboard do Pluggy (informado pelo dono)                                                                              |
| Com a CSP acima o bundle monta e roda sem violação                                                          | Testado no Chromium, **com o widget trocado por um falso** (`connect.pluggy.ai` fica fora da rede da sessão)                                        |
| O conteúdo do iframe real, o OAuth dos bancos e o `COOP` ausente                                            | **Suposição**: não foi possível abrir o widget de verdade aqui. Se algo falhar no celular, o primeiro suspeito é a CSP (ver o console do navegador) |
| `connect.pluggy.ai` aceita ser embutido por qualquer origem                                                 | Suposição (é o uso documentado)                                                                                                                     |

## Rotas

Todas as de `/v1/pluggy/*` exigem `Authorization: Bearer`; as de `/pluggy/*` são públicas e autenticadas pela sessão (ver acima).

- `GET /v1/pluggy/connections` → `{ connections }`
- `POST /v1/pluggy/connections` `{ itemId, label? }` → 201 `{ connection }` (409 se repetida; com chaves cadastradas confere no Pluggy: 422 `conexao_invalida` se o ID não existe ou é de outra conta)
- `DELETE /v1/pluggy/connections/:id` → `{ connection }` (404 se não existe)
- `POST /v1/pluggy/connect-sessions` → 201 `{ path, expiresAt }` (409 `sem_chaves` se as chaves não estão cadastradas)
- `POST /pluggy/connect-token`, `POST /pluggy/connect-complete` (públicos; 30 pedidos por IP a cada 10 min, corpo até 1 KB, mensagens fixas; 401 `sessao_invalida`, 409 `sem_chaves`, 422 `conexao_invalida`, 502 falha do Pluggy)
- `GET /pluggy/conectar`, `GET /pluggy/conectar/app.<hash>.js` e `GET /pluggy/conectar/limpar.js` (públicos; 60 por IP a cada 10 min)
- `POST /v1/pluggy/reimport` → 202 `{ deleted, sync }` (ver "Reimportar do zero")
- `GET/POST/DELETE /v1/category-rules` (Bearer): regras de categoria, ver "Categoria do banco, MCC e regras do dono"
- `POST /v1/pluggy/sync` → 202 `{ sync: "queued" | "running" }` (400 `sem_conexoes`/`sem_chaves`; 503 sem Redis). Enfileira no worker com `jobId` fixo: pedidos repetidos viram um só e nunca rodam em paralelo com o diário.
- `GET /v1/pluggy/status` → `{ keysConfigured, sync, lastSyncAt, connections }`

A API precisa de `REDIS_URL` (o compose já passa) para enfileirar; sem ele as demais rotas funcionam.
