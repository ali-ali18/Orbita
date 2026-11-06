# Design

Arquivo no Figma: https://www.figma.com/design/QLtix4jvalHCosZrhuKFtW

## Fluxos do protótipo

No modo de apresentação do Figma, página **Telas**:

- **App de finanças**: abertura → Início e tudo o que sai dele.
- **Primeira vez**: boas-vindas → servidor → bancos → notificações → orçamento.
- **Estado · sem dados**, **Estado · banco desconectado**, **Estado · servidor fora do ar**.

## Base visual

Cores, gráficos, tipografia, raios, espaços e regras de componentes estão no [styleguide](styleguide.md). Os valores moram no pacote `@orbita/tokens`, com os mesmos nomes das variáveis do Figma.

## Avatares

Gerados pelo motor de avatar do projeto Atlas (formas `blob`, `shield`, `squircle`, `gem`, `cloud`, `flower`), com olhos escuros.

| Agente          | Forma    | Cor       |
| --------------- | -------- | --------- |
| Órbita          | blob     | branco    |
| Vigia           | shield   | `#D95926` |
| Caça-assinatura | squircle | `#D55181` |
| Cofrinho        | gem      | `#199E70` |
| Fechamento      | cloud    | `#3987E5` |
| Metas           | flower   | `#C98500` |

## Logos dos bancos

Do pacote [`logos-bancos-br`](https://www.npmjs.com/package/logos-bancos-br) (MIT, logos do diretório do Open Finance), que tem versão para React Native. Busca por código COMPE ou ISPB.
