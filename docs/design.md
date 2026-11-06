# Design

Arquivo no Figma: https://www.figma.com/design/QLtix4jvalHCosZrhuKFtW

## Fluxos do protótipo

No modo de apresentação do Figma, página **Telas**:

- **App de finanças**: abertura → Início e tudo o que sai dele.
- **Primeira vez**: boas-vindas → servidor → bancos → notificações → orçamento.
- **Estado · sem dados**, **Estado · banco desconectado**, **Estado · servidor fora do ar**.

## Base visual

Tema escuro, neutro (preto, cinzas e branco). A cor fica nos gráficos e nos logos dos bancos.

| Token              | Valor     | Uso                               |
| ------------------ | --------- | --------------------------------- |
| `fundo`            | `#000000` | Fundo das telas                   |
| `superficie`       | `#141414` | Cards                             |
| `superficie-2`     | `#1F1F1F` | Elementos dentro de cards         |
| `superficie-3`     | `#2A2A2A` | Trilhos de barra, avatar sem foto |
| `borda`            | `#262626` | Divisórias                        |
| `texto`            | `#FFFFFF` | Texto principal                   |
| `texto-secundario` | `#8F8F8F` | Rótulos e legendas                |
| `texto-terciario`  | `#5A5A5A` | Placeholders                      |
| `destaque`         | `#FFFFFF` | Botão principal, chip ativo       |
| `sobre-destaque`   | `#000000` | Texto sobre o destaque            |

Raios: card 28, interno 16, pílula 999. Espaços: 4, 8, 12, 16, 20, 24.

### Paleta de gráficos

Ordem fixa, validada para daltonismo contra `#141414`. A cor segue a categoria em todas as telas.

| Slot   | Cor                  | Categoria padrão |
| ------ | -------------------- | ---------------- |
| 1      | `#3987E5` azul       | Mercado          |
| 2      | `#D95926` laranja    | Delivery         |
| 3      | `#199E70` verde-água | Transporte       |
| 4      | `#C98500` amarelo    | Assinaturas      |
| 5      | `#D55181` magenta    | Lazer            |
| outros | `#5A5A5A` cinza      | Outros           |

### Tipografia

Fonte **Geist**.

| Estilo          | Peso     | Tamanho |
| --------------- | -------- | ------- |
| Número destaque | Bold     | 40      |
| Número grande   | SemiBold | 28      |
| Número médio    | SemiBold | 20      |
| Saudação        | SemiBold | 30      |
| Título de card  | Medium   | 15      |
| Corpo           | Regular  | 15      |
| Corpo forte     | SemiBold | 15      |
| Legenda         | Regular  | 13      |
| Micro           | Medium   | 11      |

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
