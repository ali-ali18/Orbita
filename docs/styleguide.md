# Styleguide

Como o Órbita se parece e como manter isso consistente sem engessar. Os valores moram em **um lugar só**: o pacote [`@orbita/tokens`](../packages/tokens/src). Este documento explica o que cada token significa e quando usar. O Figma ([arquivo](https://www.figma.com/design/QLtix4jvalHCosZrhuKFtW)) usa os mesmos nomes como variáveis.

## Princípios

1. **Neutro por padrão, cor com significado.** A interface é preta, cinza e branca. Cor aparece só onde informa algo: gráficos (categoria), logos de banco (de qual conta é) e o verde do dinheiro que entra.
2. **Número grande, rótulo pequeno.** A hierarquia vem do tamanho e do peso, não de caixa, borda ou ícone.
3. **Token, nunca valor solto.** Se um valor não existe como token, ou você está inventando um caso novo (crie o token e documente aqui) ou está fugindo do padrão (não faça).
4. **Componente antes de tela.** Tela monta componentes; componente usa tokens.

## Cores

`import { colors } from "@orbita/tokens"`

| Token           | Valor     | Use para                                                                             | Não use para                         |
| --------------- | --------- | ------------------------------------------------------------------------------------ | ------------------------------------ |
| `background`    | `#000000` | Fundo de tela                                                                        | Card                                 |
| `surface`       | `#141414` | Card, barra de baixo, gaveta                                                         | Fundo de tela                        |
| `surface2`      | `#1F1F1F` | Elemento dentro de card (ícone em círculo, botão secundário, chip)                   | Card                                 |
| `surface3`      | `#2A2A2A` | Trilho de barra de progresso, avatar sem foto, chip selecionado secundário           | Texto                                |
| `border`        | `#262626` | Divisória entre linhas, contorno de campo                                            | Destaque                             |
| `text`          | `#FFFFFF` | Valores, títulos, texto principal                                                    | —                                    |
| `textSecondary` | `#8F8F8F` | Rótulos, legendas, datas                                                             | Valor de dinheiro                    |
| `textTertiary`  | `#5A5A5A` | Placeholder, chevron, desativado                                                     | Texto que precisa ser lido           |
| `positive`      | `#34D17A` | **Valor de dinheiro que entra**: receita, estorno e pagamento de fatura; selo "Paga" | Texto corrido, ícone, fundo, gráfico |
| `accent`        | `#FFFFFF` | Botão principal, chip ativo, switch ligado, ponto de "não lido"                      | Fundo grande                         |
| `onAccent`      | `#000000` | Texto e ícone sobre `accent`                                                         | —                                    |

**Verde só para dinheiro que entra.** `positive` colore o valor (e o selo "Paga") de receita, estorno e pagamento de fatura, junto do rótulo e do sinal (`+` em receita e estorno), então a cor reforça o texto e nunca é a única informação. Saída continua branca (`text`) e transferência entre contas próprias é neutra (`textSecondary`), porque o dinheiro só mudou de lugar. A regra mora numa função só no app, `amountTone(kind)`, usada por Início, Atividades, Detalhe e Fatura. Passa AA (4,5:1) sobre `background`, `surface` e `surface2` (teste em `@orbita/tokens`). Não existe vermelho de "negativo": a saída é o sinal `−`. Se um dia precisar de estado de erro ou aviso, crie `danger`/`warning` aqui antes de usar.

### Gráficos

`import { chart } from "@orbita/tokens"`

Uma cor por categoria padrão, em **ordem fixa**, visível sobre `surface` (`#141414`). A cor segue a **categoria**, nunca a posição no ranking: Mercado é azul em todas as telas. Categoria criada pelo dono, sem espaço escolhido, recebe uma cor estável do nome.

| Ordem | Token                        | Valor     | Categoria padrão                          |
| ----- | ---------------------------- | --------- | ----------------------------------------- |
| 1     | `chart.series[0]` azul       | `#3987E5` | Mercado                                   |
| 2     | `chart.series[1]` laranja    | `#D95926` | Delivery                                  |
| 3     | `chart.series[2]` verde-água | `#199E70` | Transporte                                |
| 4     | `chart.series[3]` amarelo    | `#C98500` | Assinaturas                               |
| 5     | `chart.series[4]` magenta    | `#D55181` | Lazer                                     |
| 6     | `chart.series[5]` violeta    | `#7C5CFF` | Moradia                                   |
| 7     | `chart.series[6]` ciano      | `#2EC4D6` | Saúde                                     |
| 8     | `chart.series[7]` vermelho   | `#E23D3D` | Transferências                            |
| 9     | `chart.series[8]` lima       | `#8FBF3F` | Investimentos                             |
| 10    | `chart.series[9]` azul-claro | `#7AA2FF` | Outros                                    |
| —     | `chart.other` cinza          | `#5A5A5A` | o que não é categoria (estorno na fatura) |

Regras:

- Cada categoria padrão tem cor. O espaço no gráfico vai de 0 a 9; se estiver vazio, vale a cor do slug.
- Todo gráfico com mais de uma série tem **legenda**; com até 4 séries, também rótulo direto. Cor nunca é a única forma de identificar.
- Texto (valor, legenda) usa `text`/`textSecondary`, nunca a cor da série. A cor fica na marca (barra, bolinha, linha).
- Comparação com período anterior: mesma cor com opacidade 35% ou linha tracejada em `chart.other`.
- Entre segmentos de barra empilhada: espaço de 2.

### Agentes

`import { agents } from "@orbita/tokens"`: cada agente tem `color` (o rosto) e `tint` (o fundo do cartão dele). A cor vem da paleta dos gráficos (Vigia laranja, Fechamento azul, Metas amarelo, Caça-assinatura magenta, Cofrinho verde-água, agente do dono violeta; a Órbita é branca); o tom é a cor a 14% sobre o preto, em hex fixo. A cor fica no rosto e no fundo do cartão, nunca no texto. O rosto é uma forma simples com dois olhos escuros (`AgentAvatar`).

### Bancos

`import { banks } from "@orbita/tokens"`: cor de fundo do círculo atrás do logo. Logos vêm do pacote `logos-bancos-br` (MIT; as marcas são das instituições, uso só para identificá-las): PNGs só dos bancos usados em `apps/mobile/assets/banks` (ver `NOTICE.txt`), casados por ISPB ou pelo nome em `lib/bank-logos.ts`. Com logo, o círculo é branco e mostra a imagem; sem logo, a cor da marca (ou `banks.generic`) com a inicial.

## Tipografia

`import { typography } from "@orbita/tokens"` · fonte **Geist**.

| Token           | Peso / tamanho / altura | Uso                                                                              |
| --------------- | ----------------------- | -------------------------------------------------------------------------------- |
| `numberDisplay` | 700 / 52 / 60           | O valor digitado em Novo lançamento (maior que `numberHero`; encolhe para caber) |
| `numberHero`    | 700 / 40 / 46           | O número principal da tela ("Dá pra gastar", valor do lançamento)                |
| `numberLarge`   | 600 / 28 / 32           | Total de card (saldo, gastos do mês)                                             |
| `numberMedium`  | 600 / 20 / 23           | Valor em card quadrado, nome em destaque                                         |
| `greeting`      | 600 / 30 / 34           | Título de tela ("Bom dia, Alisson", "Atividades")                                |
| `cardTitle`     | 500 / 15 / 20           | Rótulo do topo de card (em `textSecondary`)                                      |
| `body`          | 400 / 15 / 20           | Texto corrido, nome em lista                                                     |
| `bodyStrong`    | 600 / 15 / 20           | Nome de lançamento, valor em lista, botão                                        |
| `caption`       | 400 / 13 / 18           | Data, conta, legenda                                                             |
| `micro`         | 500 / 11 / 15           | Selo ("Ativo", "Fechada"), contador                                              |

Números usam algarismos tabulares quando ficam em coluna (lista, tabela). Valores negativos usam o sinal de menos tipográfico (`−`), não hífen.

## Raios

`import { radius } from "@orbita/tokens"`

| Token   | Valor | Uso                                                     |
| ------- | ----- | ------------------------------------------------------- |
| `sm`    | 8     | Barras de gráfico, selos pequenos                       |
| `inner` | 16    | Campo de texto, nota, caixa dentro de card              |
| `group` | 20    | Bloco de lista das Configurações (linhas com divisória) |
| `block` | 24    | Card de status das Configurações                        |
| `card`  | 28    | Card, gaveta (cantos de cima)                           |
| `pill`  | 999   | Botão, chip, barra de baixo, avatar                     |

Regra de aninhamento: elemento dentro de card usa raio **menor** que o card (`inner` dentro de `card`).

## Espaçamento

`import { spacing } from "@orbita/tokens"` · escala de 4.

| Token  | Valor | Uso típico                               |
| ------ | ----- | ---------------------------------------- |
| `xs`   | 4     | Entre título e subtítulo                 |
| `sm`   | 8     | Entre chips, ícone e texto               |
| `md`   | 12    | Entre cards, entre linhas de lista       |
| `lg`   | 16    | Margem lateral da tela, padding de linha |
| `xl`   | 20    | Padding de card                          |
| `xxl`  | 24    | Entre seções                             |
| `xxxl` | 32    | Respiro antes de ação principal          |

## Layout

`import { layout } from "@orbita/tokens"`: medidas fixas do Figma que não são passos da escala.

| Token           | Valor | Uso                                                      |
| --------------- | ----- | -------------------------------------------------------- |
| `statusBar`     | 56    | Reserva mínima no topo de toda tela (barra de status)    |
| `homeIndicator` | 28    | Folga mínima embaixo (barra de gestos do sistema)        |
| `touchTarget`   | 44    | Alvo de toque mínimo; botão menor completa com `hitSlop` |

## Movimento

`import { motion } from "@orbita/tokens"`: `fast` 150 ms (toque, chip), `normal` 250 ms (gaveta, troca de aba), `slow` 400 ms (abertura com a Órbita). Curva `standard`. Respeite "reduzir movimento" do sistema: troque deslocamento por fade.

## Componentes do app

O app (Expo) segue três camadas. Cada uma só importa da de baixo.

```
apps/mobile/src/
  ui/          # primitivos: Text, Button, Chip, Card, ListRow, Switch, Sheet, Avatar, BankLogo, ProgressBar, Ring, LineChart
  features/    # blocos por assunto: transactions/, cards/, agents/, review/, pairing/ …
  app/         # telas e rotas (Expo Router); só montam blocos de features
```

- **`ui/`** não sabe nada de finanças. Recebe props, usa tokens, tem variantes (`Button variant="primary" | "secondary"`).
- **`features/`** junta `ui/` + dados (TanStack Query) de um assunto: `TransactionRow`, `InvoiceSummary`, `AgentCard`.
- **`app/`** é fina: escolhe quais blocos aparecem e em que ordem.

**Gaveta (`Sheet`)**: toda gaveta usa o mesmo primitivo. Ancorada embaixo, sobre tudo (inclusive teclado e barra do chat), até a borda da tela (conteúdo com folga da área segura); cantos de cima `card`, fundo `surface`, fundo da tela escurecido. Barrinha no topo, sem botão X (título, se houver, é só texto). Fecha tocando fora, arrastando a barrinha para baixo ou no voltar do Android. Linhas de lista ficam em `SheetGroup` (`surface2`, raio `group`, divisória fina recuada) com `SheetRow`; campos usam `TextField` (foco por borda, sem contorno do navegador).

Para criar algo novo:

1. Já existe um primitivo 80% igual? Adicione uma variante ou prop em vez de copiar.
2. Precisa de valor novo (cor, raio, espaço)? Crie o token em `packages/tokens`, documente aqui, e só então use.
3. Componente passou de ~200 linhas? Quebre em partes na mesma pasta.

Vocabulário fixo na interface: **Painel** não existe; é **Início**. "Lançamento" (não "transação"), "Fatura", "Parcela", "Agente", "Para revisar", "Agora não" (dispensar). Botão de ação destrutiva sempre pede confirmação.

## Acessibilidade

- Contraste: texto principal sobre `background`/`surface` passa AA. `textTertiary` é só para o que não precisa ser lido.
- Alvo de toque mínimo de 44 × 44.
- Todo botão só com ícone tem rótulo para leitor de tela.
- Cor nunca é a única informação (veja Gráficos).
- Esconder valores (olho) troca números por `••••` em todas as telas, inclusive notificações.
