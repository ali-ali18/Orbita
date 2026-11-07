# Segurança

O Órbita guarda dados financeiros e chaves de API. Este documento diz o que está protegido, como, e o que fica fora.

## O que fica exposto

Só **uma porta**: a da API (3000), e mesmo ela não é publicada pelo compose. Quem dá acesso de fora é o proxy (Traefik do Dokploy, ou Caddy na VPS sem painel), sempre com HTTPS.

| Serviço  | Acessível da internet?                                  |
| -------- | ------------------------------------------------------- |
| API      | Só pelo proxy, via HTTPS                                |
| Postgres | Não. Sem porta publicada, só na rede interna do compose |
| Redis    | Não. Sem porta publicada, e com senha                   |
| Worker   | Não recebe conexões                                     |

Rotas sem autenticação: `GET /health`, `POST /v1/pairing/claim` (trocar código por token) e `GET /updates/manifest` / `GET /updates/assets/:nome` (atualização do app, protegida por assinatura: veja abaixo). Todo o resto exige o token do aparelho.

## Pareamento

- O código tem 6 números, vale **10 minutos** e **uma vez só**. Só existe um código ativo; gerar outro invalida o anterior.
- **5 tentativas por código, contadas antes de comparar.** Cada palpite reserva uma tentativa numa operação atômica no banco; sem tentativa disponível, nem compara. Assim, mil pedidos simultâneos continuam valendo só 5 palpites.
- **Teto geral:** cerca de 20 palpites errados por hora no servidor inteiro, somando todos os IPs (pedidos simultâneos podem passar um pouco disso, sempre limitados às 5 tentativas do código ativo). Estourou, o pareamento pausa (429) e o código automático só volta quando a janela passa. Com 6 números, isso dá na ordem de 500 palpites por dia: chance de acerto perto de 0,05% ao dia. Só conta palpite de verdade (código comparado); pedido sem código ativo não gasta o teto.
- **Limite por IP** (10 a cada 10 minutos). Endereços IPv6 contam pelo bloco `/64`, para que trocar de endereço dentro da mesma rede não fure o limite.
- **Troca consciente:** quem quiser pode gastar o teto geral e atrasar o seu pareamento (negação de serviço). Preferimos isso a deixar adivinharem o código. Se acontecer, desligue o automático (`PAIRING_AUTO=false`) e gere o código na hora de usar.
- No banco o código fica como **HMAC-SHA256** com uma chave derivada do `APP_SECRET`: quem ler o banco não descobre o código.
- O token do aparelho tem 256 bits aleatórios; no banco fica só o **SHA-256**. Vazar o banco não permite se passar por um aparelho.
- Comparações usam tempo constante (`timingSafeEqual`).
- **Código automático nos logs:** ao subir, se ainda não há aparelho pareado, a API gera um código e escreve nos logs (para quem usa painel, sem terminal). Ele se renova a cada 10 minutos enquanto ninguém conectar e **para quando o primeiro aparelho parear**. Para parear outro aparelho depois, gere o convite pelo app (rota autenticada) ou pelo comando `parear`. Para desligar o automático: `PAIRING_AUTO=false`.
  - Risco aceito: quem lê os logs do servidor vê o código enquanto nenhum aparelho estiver pareado. Os logs do painel só são visíveis para quem administra o servidor.
  - Pareie logo depois de subir. Se um aparelho desconhecido aparecer, desconecte-o e troque o `APP_SECRET` (o app vai listar os aparelhos conectados).

## Criptografia

- **Um segredo mestre**, `APP_SECRET` (mínimo 32 caracteres; gere com `openssl rand -base64 48`). As senhas do Postgres e do Redis entram em URLs de conexão; gere-as com `openssl rand -hex 32` (base64 pode ter `/`, que quebra a URL). Cada uso deriva uma chave própria com **HKDF-SHA256** (`orbita/pairing-code/v1`, `orbita/secret-box/v1`), então uma chave nunca serve para outra finalidade.
- **Segredos em repouso** (chave da Anthropic, credenciais do Meu Pluggy) são guardados com **AES-256-GCM**: IV aleatório por gravação, autenticação contra adulteração, e _AAD_ que amarra o valor ao campo (não dá para copiar o segredo cifrado de um campo para outro). O formato tem versão (`v1.`) para permitir troca de algoritmo.
- **Em trânsito:** HTTPS no proxy. Dentro do compose, a rede é privada.
- **No celular:** o token fica no armazenamento seguro do sistema (Keystore no Android, via `expo-secure-store`) e o app abre com biometria.

### Trocar o `APP_SECRET`

Trocar invalida o código de pareamento ativo e torna ilegíveis os segredos cifrados. Antes de trocar: anote as chaves de API para cadastrar de novo. Aparelhos pareados continuam funcionando (o token não depende do segredo).

## API

- Cabeçalhos de segurança em todas as respostas (`hono/secure-headers`).
- Limite de 16 KB por corpo de requisição.
- Sem CORS: o cliente é um app nativo, não um navegador.
- Todo corpo de requisição é validado com Zod; erro devolve mensagem genérica, nunca detalhe interno.
- IP do cliente: `TRUSTED_PROXY_HOPS` diz quantos proxies confiáveis existem na frente da API. O IP vale a N-ésima entrada **da direita** do `X-Forwarded-For` (as da esquerda podem ser forjadas pelo cliente).
  - `1`: Dokploy/Traefik (padrão do compose).
  - `2`: Cloudflare (ou outro CDN) na frente do Traefik. Só funciona se o Traefik estiver configurado para confiar nos IPs da Cloudflare (`forwardedHeaders.trustedIPs`); senão ele descarta o cabeçalho e a API usa o endereço da conexão, e todos dividiriam o mesmo limite.
  - `0`: API exposta direto, ou desenvolvimento local (padrão fora do compose). Usa o endereço da conexão e ignora o cabeçalho.

## Atualização OTA do app

O app aceita atualizações de JavaScript do próprio servidor, o que é uma via para executar código no celular. Por isso:

- **Assinatura fora do servidor.** O manifesto é assinado (RSA-SHA256) no GitHub Actions com a chave privada `OTA_SIGNING_KEY`. O servidor só guarda e repassa os bytes assinados. O app confere a assinatura contra o certificado embutido no APK **antes** de baixar qualquer arquivo e confere o hash SHA-256 de cada arquivo contra o manifesto. Servidor invadido, proxy ou CDN não conseguem fazer o app rodar código novo.
- **A chave** existe só no job `ota-sign` do `release.yml`, que faz checkout e usa o Node **sem** `pnpm install` e **sem** cache e roda o `packages/ota` (zero dependências). O job que executa `pnpm install`, Metro e plugins de terceiros (`ota-prepare`) não tem nenhum segredo, e o que constrói a imagem só recebe o `ota/` já assinado. A chave nunca está no repositório, na imagem nem no servidor. O CLI trata o artefato do build como dado não confiável (caminhos confinados, campos validados), recusa assinar se a chave não corresponde ao certificado do app ou se o certificado venceu, e a assinatura de uma release antiga (commit que já não é a ponta da `main`) é pulada.
- **Cada publicação tem id próprio** e o bundle tem como `key` o seu hash, para o celular nunca manter uma versão defeituosa por id repetido nem reaproveitar o arquivo de outra publicação.
- **Rotas públicas, de leitura e limitadas** (60 manifestos e 600 arquivos por IP a cada 10 minutos). Nome de arquivo só no formato `<sha256 em base64url>.<ext>`: qualquer outra coisa é 400 e nunca chega ao disco; o diretório é somente leitura dentro da imagem.
- **Cabeçalho `expo-signature`** só é repassado se tiver o formato esperado (uma linha, sem aspas soltas).
- **O que não cobre:** o servidor pode deixar de entregar atualizações ou entregar uma antiga (também assinada por você); não pode criar uma nova. As proteções anti-bricking do `expo-updates` ficam ligadas (o endereço é fixo no APK, vindo de `ORBITA_PUBLIC_URL`), então o app tem volta automática depois de uma atualização ruim (veja [servidor](servidor.md#riscos-e-como-o-app-se-protege)).
- **Chave comprometida ou certificado perto de vencer:** gere outro par, troque o segredo e o certificado e publique um APK novo. **APKs já instalados continuam confiando na chave antiga até serem reinstalados**: reinstale em todos os aparelhos e, até lá, considere servir a imagem sem `ota/` (veja [servidor](servidor.md#riscos-e-como-o-app-se-protege)).

## Meu Pluggy

- Client ID e Client Secret ficam só no cofre (AES-GCM, AAD = nome). O worker os abre com `vault.read`; nenhuma rota devolve valor, nem parte dele. A `apiKey` do Pluggy (2 h) vive só na memória do processo.
- O cliente fala só com `https://api.pluggy.ai` (host fixo no código), sem seguir redirecionamento, com timeout (20 s) e limite de 5 MB por resposta. Os IDs que entram no caminho da URL são validados (UUID / `[A-Za-z0-9_-]`).
- Toda resposta do Pluggy passa por Zod. Formato inesperado vira erro claro; o texto do erro vem de uma lista fixa em pt-BR e **nunca** cita o corpo da resposta, a URL, a chave ou o segredo. É isso que vai para `lastError` e para o app.
- Nome, descrição e categoria que vêm do banco são **dados**, nunca instrução (mesma regra das notificações).
- A tela só vê estado (`ok`, `partial`, `error`, `no_keys`), datas e a mensagem sanitizada.

## Containers

- Imagem roda como usuário `node`, nunca root.
- API, worker e migração rodam com sistema de arquivos **somente leitura** (`read_only`, só `/tmp` gravável), sem capacidades do kernel (`cap_drop: ALL`) e com `no-new-privileges`.
- A imagem é construída pelo GitHub Actions a partir do código público, com SBOM e proveniência, **só depois que o CI passa** num push ao `main` deste repositório (PRs e forks nunca publicam; o disparo manual só é aceito no `main`); o servidor só baixa. Nada de segredo dentro da imagem.
- A senha do Redis aparece no comando do container (`docker inspect`, `ps`). Só quem já tem acesso ao Docker da máquina vê isso.

## Agentes de IA

- Texto vindo de notificação, comprovante, extrato ou banco é **dado, nunca instrução**. A extração desses textos roda numa chamada **sem ferramentas**: mesmo que alguém esconda uma ordem num comprovante, a IA não tem como executar nada.
- A IA **só lê** dinheiro: não existe ferramenta que faça Pix ou pagamento.
- Toda escrita dos agentes (lançar, recategorizar) gera um card com **Desfazer**.
- Gasto com IA tem limite mensal configurável.

## Dependências

- Dependabot semanal para npm, Docker e GitHub Actions.
- Dependências npm com versão exata e lockfile no repositório; o CI instala com `--frozen-lockfile`.
- Imagens Docker e GitHub Actions usam tags de versão (`postgres:16-alpine`, `@v4`), sem digest. O Dependabot mantém atualizadas; fixar por digest/SHA é um próximo passo.

## O que **não** está coberto

- **Servidor comprometido:** quem tem root na VPS lê o `APP_SECRET` e, com ele, os segredos cifrados. A criptografia protege contra vazamento do **banco** (backup exposto, dump), não contra invasão da máquina.
- **Limite de requisições em memória:** vale por instância. Com uma instância da API (o padrão), funciona; se escalar para várias, mova para o Redis.
- **Backups:** o Postgres precisa de backup fora da VPS (o Dokploy faz backup agendado de banco para S3). Backup em texto puro é sensível: guarde num bucket privado.

## Reportar

Achou uma falha? Não abra issue pública: fale direto com o dono do repositório.
