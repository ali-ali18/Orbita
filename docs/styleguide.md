# Styleguide

Como o Órbita se parece e como manter isso consistente sem engessar. Os valores moram em **um lugar só**: o pacote [`@orbita/tokens`](../packages/tokens/src). Este documento explica o que cada token significa e quando usar. O Figma ([arquivo](https://www.figma.com/design/QLtix4jvalHCosZrhuKFtW)) usa os mesmos nomes como variáveis.

## Princípios

1. **Neutro por padrão, cor com significado.** A interface é preta, cinza e branca. Cor aparece só onde informa algo: gráficos (categoria), logos de banco (de qual conta é) e o verde do dinheiro que entra.
2. **Número grande, rótulo pequeno.** A hierarquia vem do tamanho e do peso, não de caixa, borda ou ícone.
3. **Token, nunca valor solto.** Se um valor não existe como token, ou você está inventando um caso novo (crie o token e documente aqui) ou está fugindo do padrão (não faça).
4. **Componente antes de tela.** Tela monta componentes; componente usa tokens.

## Cores

`import { colors } from "@orbita/tokens"`

| Token             | Valor                   | Use para                                                                                                                               | Não use para                                                      |
| ----------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `background`      | `#000000`               | Fundo de tela                                                                                                                          | Card                                                              |
| `surface`         | `#141414`               | Card, barra de baixo, gaveta                                                                                                           | Fundo de tela                                                     |
| `surface2`        | `#1F1F1F`               | Elemento dentro de card (ícone em círculo, botão secundário, chip)                                                                     | Card                                                              |
| `surface3`        | `#2A2A2A`               | Trilho de barra de progresso, avatar sem foto, chip selecionado secundário                                                             | Texto                                                             |
| `border`          | `#262626`               | Divisória entre linhas, contorno de campo                                                                                              | Destaque                                                          |
| `text`            | `#FFFFFF`               | Valores, títulos, texto principal                                                                                                      | —                                                                 |
| `textSecondary`   | `#8F8F8F`               | Rótulos, legendas, datas                                                                                                               | Valor de dinheiro                                                 |
| `textTertiary`    | `#5A5A5A`               | Placeholder, chevron, desativado                                                                                                       | Texto que precisa ser lido                                        |
| `positive`        | `#34D17A`               | **Valor de dinheiro que entra**: receita, estorno e pagamento de fatura; selo "Paga"                                                   | Texto corrido, ícone, fundo, gráfico                              |
| `danger`          | `#FF6B6B`               | Ação destrutiva no menu do widget ("Remover"), sempre com rótulo e ícone                                                               | Valor de dinheiro, fundo                                          |
| `accent` (tema)   | `#FFFFFF` no tema Atual | Só **ação e seleção**: botão principal, botão +, chip/aba ativos, switch ligado, ponto de "não lido", barra selecionada de série única | Fundo grande, texto, valor de dinheiro, cor de categoria ou série |
| `onAccent` (tema) | `#000000` no tema Atual | Texto e ícone sobre `accent`                                                                                                           | —                                                                 |

### Cor primária e temas

`accent`/`onAccent` **não são tokens de `colors`**: vêm do tema que o dono escolhe em Configurações → Aparência → Tema (`accentThemes` em `@orbita/tokens`). O app lê só por `useAccent()` (ou `useTheme()`), de `lib/theme.tsx`; usar `colors.accent` ou `accentThemes` fora do provider quebra o teste de guarda (`lib/theme-model.test.ts`). A escolha vale na hora e fica **neste aparelho** (`orbita.accentTheme`, como "Esconder valores ao abrir"); a splash espera a leitura, então não pisca de branco para a cor.

| Chave     | Nome       | `accent`  | `onAccent` | Observação                                                      |
| --------- | ---------- | --------- | ---------- | --------------------------------------------------------------- |
| `atual`   | Atual      | `#FFFFFF` | `#000000`  | Padrão                                                          |
| `volt`    | Verde volt | `#C2FF19` | `#000000`  |                                                                 |
| `amarelo` | Amarelo    | `#FFC700` | `#000000`  |                                                                 |
| `azul`    | Azul       | `#2F5BFF` | `#FFFFFF`  | 3,6:1 sobre `surface`: só elemento gráfico, nunca texto pequeno |
| `fucsia`  | Fúcsia     | `#FF2EE6` | `#000000`  |                                                                 |
| `laranja` | Laranja    | `#FF7A1A` | `#000000`  | Branco sobre ele falha AA                                       |
| `violeta` | Violeta    | `#7447FF` | `#FFFFFF`  | 3,6:1 sobre `surface`: só elemento gráfico, nunca texto pequeno |

Teste em `@orbita/tokens`: `onAccent` ≥ 4,5:1 sobre o `accent`; `accent` ≥ 3:1 sobre `background`, `surface` e `surface2`.

**Regra de uso.** A primária é só ação e seleção. Nunca como cor de categoria ou de série de gráfico por categoria, nunca em texto de valor de dinheiro, nunca como cor de texto corrido (use `text`). Barra de progresso, status ("conectado") e o avatar da Órbita são neutros (`text`), não seguem o tema.

### Card de destaque

`<Card highlight>` · `import { highlight } from "@orbita/tokens"`

O card "herói" da tela ganha uma **borda de brilho**: forte no canto de cima à esquerda, some ao longo das duas arestas, fica sem borda no meio e reaparece, mais fraca, no canto de baixo à direita. Junto vem uma **luz suave** saindo do mesmo canto de cima. As duas são **sempre neutras**: o branco de `colors.text` em opacidades decrescentes (o "prata"), em qualquer tema. O destaque **não segue o tema** e não é uso da cor primária (o componente não chama `useAccent()`). Os demais cards continuam sem borda.

| Token (`highlight.subtle` / `.strong`) | Sutil | Marcante | O que é                                                                       |
| -------------------------------------- | ----- | -------- | ----------------------------------------------------------------------------- |
| `strokeWidth`                          | 1     | 1,5      | Espessura do traço                                                            |
| `nearOpacity`                          | 0,9   | 1        | Opacidade da borda no canto iluminado                                         |
| `farOpacity`                           | 0,5   | 0,8      | Opacidade da borda no canto oposto                                            |
| `fadeAt`                               | 0,3   | 0,42     | Onde a borda some (0 = canto iluminado, 0,5 = os outros cantos, 1 = o oposto) |
| `glowOpacity`                          | 0,06  | 0,085    | Opacidade da luz no canto                                                     |
| `glowRadius`                           | 0,8   | 1,1      | Raio da luz, em larguras do card                                              |

`highlight.default` é `subtle`: é o que `<Card highlight>` usa. `highlight="strong"` existe para comparar; não use sem combinar antes.

Regras:

- **No máximo um por tela visível**, e só no card que resume a tela (o número principal). Se a tela não tem um card assim (o total é texto solto), fica sem destaque: não se cria card só para brilhar.
- **Nunca em item de lista repetida**, widget 2x2 nem gaveta. Destaque em todo card deixa de ser destaque.
- É decoração: não carrega informação, não recebe toque e é invisível para o leitor de tela. Estado de erro do card fica sem ela.
- **O texto mantém o contraste.** A luz clareia o fundo do card; por isso `glowOpacity` tem teto. Teste em `@orbita/tokens`: `text`, `textSecondary` e `positive` continuam em 4,5:1 sobre o ponto mais claro da luz. Subir a opacidade exige passar nesse teste.
- Estático por enquanto. Se ganhar movimento, respeita "reduzir movimento" (fica parado).

Onde está hoje: Início ("Dá pra gastar até o fim do mês"), Cartão › Faturas com um cartão escolhido ("O que entrou nela") e agente Economia ("Dá para cortar até…"). O desenho é SVG (`ui/CardHighlight.tsx`), com a geometria em função pura (`ui/highlight-geometry.ts`).

**Conflitos conhecidos** (não travam a escolha; só vale saber): laranja parece a marca do Inter e a categoria Delivery; amarelo parece o Mercado Pago; volt parece o verde de valor positivo (`positive`); violeta fica perto da categoria Moradia (`#7C5CFF`) e da marca Nubank. Como a primária só aparece em ação e seleção, e nunca em gráfico, a confusão é de leitura rápida, não de significado.

**Verde só para dinheiro que entra.** `positive` colore o valor (e o selo "Paga") de receita, estorno e pagamento de fatura, junto do rótulo e do sinal (`+` em receita e estorno), então a cor reforça o texto e nunca é a única informação. Saída continua branca (`text`) e transferência entre contas próprias é neutra (`textSecondary`), porque o dinheiro só mudou de lugar. A regra mora numa função só no app, `amountTone(kind)`, usada por Início, Atividades, Detalhe e Fatura. Passa AA (4,5:1) sobre `background`, `surface` e `surface2` (teste em `@orbita/tokens`). Não existe vermelho de "negativo": a saída é o sinal `−`. `danger` (vermelho, AA sobre as três superfícies) existe só para ações destrutivas com rótulo, como "Remover" no menu do widget; estado de aviso ainda não tem token (crie `warning` aqui antes de usar).

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
- **Rosca (`DonutChart`)** para parte de um todo (gasto por categoria): segmentos nas cores das categorias, pontas redondas, espaço `spacing.xs` entre eles, começa no topo no sentido horário. O total vai no centro (`numberMedium` + "gastos esse mês" em `caption`) e a lista embaixo traz cor, nome, % e valor (`CategoryDonut`, usado no card "Gastos por categoria" do Início e em "Como chegamos nesse número"). Fatia menor que a folga vira um ponto, sem sobrepor a vizinha. Não use rosca para comparar períodos (aí é barra ou linha) nem com um só segmento.

### Menos texto

Cada card do Início mostra **um número principal e no máximo uma linha de apoio**. O mesmo número não aparece em dois cards (o Gasto do mês é o "Gasto R$ X" do card principal, que abre a linha dia a dia). "Atualizado há…" e "estimado" ficam só nas telas de detalhe, e "estimado" vira **um aviso por tela**, nunca um sufixo em cada valor.

### Widgets do Início

Cada card do Início é um widget com tamanho `2x2` (quadrado de meia largura, 221 de altura mínima), `2x4` (largura cheia, baixo: um número, uma linha de apoio e no máximo um gráfico pequeno) ou `4x4` (largura cheia, alto: lista de até 5 linhas). Todo tamanho segue "Menos texto" e só exibe o que a API devolve. O menu de segurar usa `Sheet`, `SheetGroup` e `Segmented`; "Remover" usa o token `danger` com ícone e rótulo. Catálogo, grade e edição em [arquitetura](arquitetura.md#widgets-do-início).

### Agentes

`import { agents } from "@orbita/tokens"`: cada agente tem `color` (o rosto) e `tint` (o fundo do cartão dele). A cor vem da paleta dos gráficos (Vigia laranja, Fechamento azul, Metas amarelo, Caça-assinatura magenta, Cofrinho verde-água, Economia verde-lima, agente do dono violeta; a Órbita é branca); o tom é a cor a 14% sobre o preto, em hex fixo. A cor fica no rosto e no fundo do cartão, nunca no texto. O rosto é uma forma simples com dois olhos escuros (`AgentAvatar`).

### Economia (tela do agente)

A tela do agente Economia segue "Menos texto": o seletor **Autonomia** (duas opções em rádio; a segunda pede confirmação), **Onde cortar** (um número no topo, "Dá para cortar até R$ X por mês", no [card de destaque](#card-de-destaque) da tela, e cartões `surface` com título, valor por mês, uma linha de texto, a confiança em `Chip` e no máximo uma ação de um toque mais "Ignorar", `compact`; só os 4 primeiros, o resto em "Ver todos") e **O que fiz sozinho** (o quê, por quê, quantos lançamentos de evidência e **Desfazer**; o desfeito troca o botão pela nota). O achado que não soma no total leva uma linha curta dizendo isso. Valores seguem o olho fechado. Lógica em `features/agents/economy-model.ts`.

### Bancos

`import { banks } from "@orbita/tokens"`: cor de fundo do círculo atrás do logo. Logos vêm do pacote `logos-bancos-br` (MIT; as marcas são das instituições, uso só para identificá-las): PNGs só dos bancos usados em `apps/mobile/assets/banks` (ver `NOTICE.txt`), casados por ISPB ou pelo nome em `lib/bank-logos.ts`. Com logo, o círculo é branco e mostra a imagem; sem logo, a cor da marca (ou `banks.generic`) com a inicial.

### Ícones de categoria e de lojas

O disco de 44 do lançamento (`TransactionDisc`, `StoreDisc`) mostra, nesta ordem: o **logo do banco** (Nubank, Inter, Santander, Itaú, Bradesco, Caixa, Mercado Pago), o **glifo da marca** (Spotify, Netflix, Uber…) ou, sem marca reconhecida, o **ícone da categoria** em `surface2`. Nunca mostra letra. Pela mesma regra o disco aparece nas assinaturas (lista, widget e chat de configuração).

- **Categoria → ícone**: `categoryIcon(slug, nome)` em `summary/transaction-model.ts`. Slug do sistema manda (Mercado, Delivery → comida, Transporte, Assinaturas, Lazer, Moradia → casa, Saúde, Transferências, Investimentos, Salário, Fatura de cartão, Outros → etiqueta); categoria do dono cai nas palavras do nome (Restaurante, Farmácia, Educação, Compras, Viagens…) e, sem nada, em "etiqueta". Os ícones são do conjunto de `ui/icons.tsx` (traço 1,75, viewBox 24).
- **Loja → marca**: `brandOf(texto)` em `lib/brands.ts` (função pura, ~45 marcas), usando `subscriptionBrand` e `friendlyMerchantName` para limpar o texto do banco ("DL*Spotify P48CE", "MLP KABUM-KABUM"). Só despesa e estorno têm marca.
- **Cores**: `brandDiscs` em `@orbita/tokens` (disco e glifo, contraste AA testado). Uma regra só: imitar o **ícone de app oficial** como aparece na tela do celular. Fundo preto/escuro com logo colorido (Netflix, Spotify, Claude, Amazon, Steam), fundo branco com logo colorido (Google, YouTube, Airbnb, Microsoft) ou cor da marca com logo branco (iFood, Vivo, Booking, Shopee, Adobe), nunca o glifo invertido. Se o branco não passa AA na cor oficial, usa-se um tom mais fechado dela. Disco escuro ganha borda `colors.border` para não sumir no fundo preto do app (`StoreDisc`). Marca sem glifo livre fica na cor aproximada com um ícone genérico do app, sem desenhar o logotipo.
- **Origem e licença** dos glifos (Simple Icons, CC0) em `apps/mobile/assets/brands/NOTICE.txt`. Marca nova: catálogo, tokens e `scripts/gerar-marcas.mjs`.

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
| `donut`         | 176   | Diâmetro da rosca de categorias (`DonutChart`)           |
| `donutStroke`   | 20    | Espessura do anel da rosca                               |

## Movimento

`import { motion } from "@orbita/tokens"`: `fast` 150 ms (toque, chip), `normal` 250 ms (gaveta, troca de aba), `slow` 400 ms (abertura com a Órbita). Curva `standard`. Respeite "reduzir movimento" do sistema: troque deslocamento por fade.

## Componentes do app

O app (Expo) segue três camadas. Cada uma só importa da de baixo.

```
apps/mobile/src/
  ui/          # primitivos: Text, Button, Chip, Card, ListRow, Switch, Sheet, Avatar, BankLogo, ProgressBar, Ring, DonutChart, LineChart
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
