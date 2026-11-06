# Órbita

Organizador financeiro pessoal com agentes de IA. **Self-hosted e open source**: o app (Android) conversa só com o seu servidor, e o seu servidor guarda tudo.

- Junta contas e cartões de vários bancos pelo **Open Finance**, de graça, via [Meu Pluggy](https://www.pluggy.ai/meu-pluggy) (até 5 conexões das suas próprias contas).
- Lança gastos sozinho lendo as **notificações dos bancos** no Android, **comprovantes** (Pix, boleto) e **extratos** (CSV, OFX, PDF).
- Entende **fatura de cartão de verdade**: fechamento, vencimento, parcelas, estornos e pagamento de fatura (que não é gasto).
- **Agentes** que cuidam de partes do seu dinheiro e avisam antes do problema: Órbita (a principal), Vigia, Fechamento, Metas, Caça-assinatura e Cofrinho.

> Status: em planejamento. Ainda não há código.

## Como funciona

```
App (Expo / React Native, Android)
   │  chat, telas, push
   ▼
API (Hono)  ──►  Engine financeiro (funções puras, testadas)
   │                 ▲
   ├──► Agentes IA ──┘  (os agentes só chamam ferramentas do engine)
   ▼
Postgres (Prisma)  ◄──  Worker (BullMQ): Meu Pluggy, relatórios, alertas, recorrências
```

A regra principal: **a IA nunca faz conta**. Saldo, fatura, parcelas e orçamento vêm de código determinístico e testado; os agentes interpretam o pedido e chamam as ferramentas.

## Documentação

| Documento                          | O que tem                                                |
| ---------------------------------- | -------------------------------------------------------- |
| [Plano](docs/plano.md)             | O produto, as peças e a ordem de construção              |
| [Arquitetura](docs/arquitetura.md) | Módulos, quem importa quem, como acrescentar uma feature |
| [Segurança](docs/seguranca.md)     | O que está exposto, criptografia, pareamento, limites    |
| [Servidor](docs/servidor.md)       | Subir no Dokploy (ou numa VPS) e parear o celular        |
| [Styleguide](docs/styleguide.md)   | Tokens de cor, tipografia, raios, espaços e componentes  |
| [Design](docs/design.md)           | Figma, fluxos do protótipo, avatares e logos             |

## Contribuições

Projeto pessoal: não aceito contribuições, issues ou pull requests. Fique à vontade para fazer um fork.

## Licença

[MIT](LICENSE)
