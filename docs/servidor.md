# Servidor

Como colocar o Órbita no ar e parear o celular. O caminho principal é o **Dokploy**; no fim, a alternativa para uma VPS sem painel.

A imagem é construída pelo GitHub Actions e publicada em `ghcr.io/ali-ali18/orbita`. O servidor **não compila nada**: só baixa a imagem pronta.

## Dokploy

### 1. Criar o serviço

1. No projeto, **Create Service → Compose**.
2. Fonte: **Raw**, colando o conteúdo do `docker-compose.yml` deste repositório. (Também funciona com **Git** apontando para o `main`; veja o cuidado no passo 4.)
3. Em **Environment**, preencha. As senhas do Postgres e do Redis vão dentro de URLs: gere com `openssl rand -hex 32` (só letras e números). O `APP_SECRET` pode ser `openssl rand -base64 48`.

   ```env
   POSTGRES_PASSWORD=...
   REDIS_PASSWORD=...
   APP_SECRET=...
   ```

   Opcionais: `ORBITA_VERSION` (tag da imagem, padrão `latest`), `PAIRING_AUTO=false` (desliga o código automático), `TRUSTED_PROXY_HOPS=2` se houver Cloudflare na frente do Dokploy, `CHAT_MODEL`, `CHAT_MODEL_FAST` (`off` desliga o modelo barato) e `CHAT_EFFORT` (`low`, `medium`, `high`) como padrão do modelo do chat (o que o dono escolhe no app vence), e `AGENT_AI_WORDING=false` para desligar a reescrita dos avisos dos agentes por IA (os avisos saem com o texto-modelo; o worker roda os agentes de hora em hora, sem custo quando não há IA). A chave da Anthropic **não** vai aqui: cadastre no app, em _Configurações → Servidor e chaves_, onde também ficam o custo do mês e o limite de gasto com a IA.

### 2. Domínio

Na aba **Domains** do serviço: escolha o serviço **`api`**, porta **3000**, seu domínio, e ative HTTPS (Let's Encrypt). Não publique portas no compose: o Traefik do Dokploy faz a ponte.

### 3. Subir e parear

Clique em **Deploy**. A ordem é: Postgres e Redis ficam saudáveis → `migrate` aplica as migrações → `api` e `worker` sobem.

Abra os **Logs** do serviço `api`. Enquanto não houver aparelho pareado, aparece um quadro com o código:

```
====================================================
  ÓRBITA — pareamento

        CÓDIGO:  482 913

  Vale até 14:32 (horário de Brasília), uma vez só.
  Digite este código no app. Se ninguém conectar em 10 minutos, eu gero outro.
====================================================
```

O app Android vem de um APK baixado do GitHub: veja [`app-android.md`](app-android.md). Mudanças só de JavaScript chegam sem APK novo: veja [Atualizar o app sem APK](#atualizar-o-app-sem-apk).

No app, digite o endereço (`https://seu-dominio`) e o código. Depois do primeiro aparelho, o código automático para. Para parear outro aparelho, gere o convite pelo app já pareado (_Configurações → Servidor e chaves_).

### 4. Atualizar sozinho

1. No Dokploy, ative **Auto Deploy** no serviço e copie a URL do webhook.
2. No GitHub, em _Settings → Secrets and variables → Actions_, crie o segredo **`DOKPLOY_WEBHOOK_URL`** com essa URL.

A cada push no `main`, o CI roda; **só se passar**, o GitHub Actions publica a imagem nova e chama o webhook. O compose usa `pull_policy: always`, então o Dokploy baixa a imagem nova ao redeployar. Se o webhook falhar, a imagem fica publicada e basta clicar em **Deploy** no painel.

Se a fonte do serviço for **Git** com a integração do GitHub, o Dokploy também redeploya a cada push, possivelmente **antes** de a imagem nova estar pronta. Nesse caso, desligue o redeploy por push e deixe só o webhook acima disparar.

### Imagem privada?

Se o pacote aparecer como privado no GHCR, deixe-o público em _GitHub → Packages → orbita → Package settings → Change visibility_, ou cadastre o GHCR no Dokploy (_Settings → Registry_, usuário do GitHub e um token com `read:packages`).

### Backup

Use o backup agendado do Dokploy para o Postgres (destino S3). Guarde num bucket privado: o backup tem seus dados financeiros.

## Saída para o Banco Central (CDI)

O worker passa a chamar `https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados` (série pública do CDI diário, sem chave) uma vez por dia (08:20, America/Sao_Paulo) e uma vez quando sobe, para o app calcular o rendimento esperado dos investimentos. **Só saída HTTPS (443)**: se o servidor filtra a saída, libere `api.bcb.gov.br`. Não há variável de ambiente nova. Sem acesso, o resto do app funciona; os investimentos só mostram "a série do CDI ainda não cobre o período" e o worker registra a falha no log (`[atualizar-cdi] falhou`). Na primeira subida a série vem de 8 anos para trás (uma chamada; a API do Banco Central responde 406 para janelas de 10 anos ou mais). O job tem 3 tentativas com espera exponencial e repara buracos antigos da série.

## Atualizar o app sem APK

Mudou só o JavaScript do app (telas, textos, regras)? Não precisa instalar APK novo. O servidor Órbita, o mesmo que o app pareou, entrega a atualização; o app baixa em segundo plano e aplica **quando você volta ao app depois de pelo menos 1 minuto fora** (ou no próximo início a frio). Sem EAS e sem terceiros.

### Como funciona

1. A cada release (`release.yml`, depois do CI verde na `main`) o GitHub Actions exporta o JS do app (`expo export --platform android`), monta o **manifesto** (id, hashes SHA-256 dos arquivos, `runtimeVersion`) e o **assina** com a chave privada (segredo `OTA_SIGNING_KEY`).
2. O resultado vai para dentro da imagem Docker, em `/app/ota`. Nada é gerado nem assinado no servidor. Cada publicação recebe um `id` novo (mesmo que o conteúdo volte a ser igual ao de uma versão antiga, para o celular trocar a versão defeituosa pela revertida) e o bundle tem como `key` o seu próprio hash (para o celular nunca reaproveitar o arquivo de uma publicação anterior).
3. O APK é construído já apontando para `${ORBITA_PUBLIC_URL}/updates/manifest` (o endereço fica fixo no APK). O app, em cada abertura e ao voltar do segundo plano (no máximo a cada 15 minutos), pergunta a esse endereço **só se o servidor pareado for o mesmo host** de `ORBITA_PUBLIC_URL`; pareado com outro servidor, ou sem servidor, ele não checa nada. Se o `runtimeVersion` combina e há atualização nova, ele baixa os arquivos de `/updates/assets/...`. Uma checagem que falha (servidor reiniciando no redeploy, sem rede) é repetida depois de 1 minuto, não de 15.
4. A atualização baixada entra em uso quando o JavaScript reinicia: o app faz isso sozinho **ao voltar depois de pelo menos 1 minuto fora** (volta para a primeira tela já na versão nova). Numa volta rápida, como ir ao app do banco no meio de um lançamento, nada reinicia e o rascunho fica; a atualização continua pendente até uma volta mais longa. Em qualquer **início a frio** ela entra direto, sem nada disso: o `expo-updates` abre sempre a atualização mais nova (`createdAt`) que já está baixada e é do mesmo `runtimeVersion`. Ele nunca reinicia com você usando a tela; o botão **Reiniciar o app para aplicar** do Diagnóstico aplica na hora.
5. Antes de usar qualquer coisa, o app confere a **assinatura do manifesto** contra o certificado público embutido no APK (`apps/mobile/certs/ota-certificate.pem`) e o hash de cada arquivo contra o manifesto. Assinatura inválida: a atualização é descartada.

Por isso as rotas `/updates/*` não têm login: o código é aberto e a integridade vem da assinatura. **Quem invadir o servidor não consegue fazer o app rodar código dele**: sem a chave privada (que só existe no GitHub), o app recusa. O que a pessoa consegue é só deixar de entregar atualizações (ou entregar uma antiga, veja "Riscos").

### Configurar (uma vez)

Peça ao assistente ou faça à mão, num computador com o repositório instalado (`pnpm install`).

```bash
# 1. Gerar a chave privada e o certificado (a pasta das chaves fica FORA do repositório)
pnpm --filter @orbita/mobile exec expo-updates codesigning:generate \
  --key-output-directory ~/orbita-ota-keys \
  --certificate-output-directory ~/orbita-ota-certs \
  --certificate-validity-duration-years 10 \
  --certificate-common-name "Orbita"

# 2. O certificado (público) vai para o repositório
mkdir -p apps/mobile/certs
cp ~/orbita-ota-certs/certificate.pem apps/mobile/certs/ota-certificate.pem
git add apps/mobile/certs/ota-certificate.pem && git commit -m "chore(mobile): certificado público das atualizações OTA"
```

3. Em _Settings → Secrets and variables → Actions_ do GitHub:
   - **Secret** `OTA_SIGNING_KEY`: o conteúdo inteiro de `~/orbita-ota-keys/private-key.pem` (com as linhas `-----BEGIN ... -----`).
   - **Variable** `ORBITA_PUBLIC_URL`: o endereço público do servidor, **https**, sem barra no fim (ex.: `https://financas.seudominio.dev`). Ele entra no manifesto assinado como endereço dos arquivos **e** no APK como endereço das atualizações. Precisa ser o mesmo endereço que você digita ao parear.
4. Guarde `private-key.pem` num cofre (gerenciador de senhas) e **apague a cópia local**. Não commite nada de `~/orbita-ota-keys`.
5. Gere um **APK novo** (o certificado e o `runtimeVersion` vão dentro dele) e instale. A partir daí, os releases seguintes chegam por OTA. O APK precisa ser construído **depois** de cadastrar `ORBITA_PUBLIC_URL` e commitar o certificado.

Sem a chave, sem a variável ou sem o certificado, o `release.yml` só avisa e a imagem sai **sem atualização**: o servidor responde "sem atualização" (HTTP 204) e tudo segue como antes. Sem a variável `ORBITA_PUBLIC_URL` ou sem o certificado no momento do build, o **APK** também sai com o OTA desligado, como era antes.

Trocar de domínio muda `ORBITA_PUBLIC_URL`, o que muda o `runtimeVersion`: exige APK novo.

### Quando precisa de APK novo e quando não

O app só aceita atualização do mesmo **`runtimeVersion`** do APK instalado. Ele é a _impressão digital_ do projeto nativo (`@expo/fingerprint`): muda sozinho quando muda qualquer coisa nativa, e **não** muda com código JS, textos ou imagens.

| Mudou…                                                                                                                                                         | Precisa de APK novo?                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Telas, textos, regras, estilos, imagens e fontes já usados, cálculo de valores (TypeScript)                                                                    | **Não**, chega por OTA                                                     |
| Dependência com código nativo (`expo-*`, `react-native-*`), versão do Expo/React Native, plugins, `app.json` nativo (permissões, ícone, nome), certificado OTA | **Sim**: o `runtimeVersion` muda e o APK antigo deixa de receber o JS novo |
| Só o `version` do `app.json`                                                                                                                                   | Não (não entra na impressão digital)                                       |

Exemplo: o **desbloqueio por biometria** (`expo-local-authentication` + permissão `USE_BIOMETRIC`) é nativo. Quem não instalar o APK novo continua no app anterior, sem o interruptor, mesmo com OTA publicada. Ao gerar o APK, avise nas notas da versão: "Desbloquear com digital: precisa instalar o APK novo".

Você não precisa lembrar disso: o CI calcula o `runtimeVersion` do APK e da atualização com o mesmo comando (`node packages/ota/src/cli.ts runtime-version`), e um APK antigo com runtime diferente simplesmente não recebe o JS novo (continua funcionando com o que tem). Três conferências automáticas:

- **CI, job "Atualização OTA (chave de teste)":** calcula o `runtimeVersion` com as variáveis do APK (`ORBITA_VERSION_CODE`, sufixo do commit) e com as do Release e **falha** se os valores divergirem (ele não pode depender de versão nem de commit).
- **CI, em pull request:** compara o `runtimeVersion` do PR com o da base e escreve um aviso: "Chega por OTA" ou **"Este PR exige APK novo"**. É só aviso, não falha.
- **`app-android.yml`, "Conferir o runtimeVersion dentro do APK":** lê `assets/fingerprint` de dentro do APK pronto e **não publica** se for diferente do valor calculado para a atualização.

Para ver o valor: o log do passo "Fixar o runtimeVersion do OTA" em `app-android.yml`, a linha "runtimeVersion da atualização OTA" do `release.yml`, as notas do release do APK e, no celular, _Configurações → Servidor e chaves → Atualização do app_.

### A atualização não chegou?

Abra _Configurações → Servidor e chaves → Atualização do app_ (é o bloco do topo do Diagnóstico; também entra no "Copiar como texto"). Ele mostra:

| Linha                                  | O que dizer dela                                                                                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **APK instalado**                      | versão e código do APK (o código é `1000 + número do build`).                                                                                                      |
| **JavaScript em uso**                  | versão com o commit (`0.1.0+abc1234`) e se é "o que veio no APK" ou "baixado do servidor". É aqui que se vê se a atualização entrou.                               |
| **runtimeVersion do APK**              | tem de ser igual ao do "Servidor oferece". Diferente: aquele APK não recebe a atualização, instale o APK novo.                                                     |
| **Endereço no APK / Servidor pareado** | só o host. "DIFERENTE do APK" = pareado por outro endereço (IP, porta, outro domínio): o app não confere atualização. Pareie pelo endereço de `ORBITA_PUBLIC_URL`. |
| **Servidor oferece**                   | o que a imagem em execução tem em `/app/ota` (`GET /v1/server`, campo `ota`). "nenhuma atualização" = imagem sem OTA ou redeploy que não pegou a imagem nova.      |
| **Última checagem**                    | hora e resultado (`nenhuma atualização nova`, `atualização baixada`, `falhou: …`). Erros recentes do atualizador nativo aparecem embaixo.                          |

**Procurar atualização agora** confere na hora, sem esperar os 15 minutos. Se baixar, aparece **Reiniciar o app para aplicar**.

**O caso de 10/11/2026 (documentado para não repetir a investigação).** Um APK do commit `90428ca` não mostrou o JS do commit `5536324`, só de JavaScript. O que a evidência mostrou: o `runtimeVersion` era **o mesmo** nos dois lados (`2740e9eb…`, no log dos dois workflows e no arquivo `assets/fingerprint` de dentro do APK publicado), o certificado dentro do APK era o do repositório, e o servidor, rodando localmente com uma atualização gerada pelo mesmo comando, respondeu `200` com o manifesto assinado ao pedido que o `expo-updates` faz. Ou seja: a impressão digital **não** muda a cada commit (`version`, `versionCode` e código JS ficam de fora). O defeito encontrado estava no app (reproduzido em teste; o aparelho e o servidor em produção não puderam ser inspecionados na investigação, e é para isso que o bloco acima existe): a atualização baixada só entrava em uso num **início a frio** do processo, e no Android "abrir o app de novo" quase sempre só traz o processo de volta; além disso, uma checagem que falhasse (o servidor reiniciando no redeploy) deixava o app 15 minutos sem tentar de novo, e não havia como ver nada disso na tela. Instalar um APK mata o processo, por isso "só chegava com APK". Corrigido: aplica ao voltar depois de 1 minuto fora, tenta de novo em 1 minuto depois de erro, e o Diagnóstico mostra cada etapa.

### Riscos e como o app se protege

- **Atualização com defeito:** as proteções anti-bricking do `expo-updates` ficam **ligadas** (o endereço é fixo no APK, então não é preciso o `disableAntiBrickingMeasures`). Se o JS novo quebrar antes da primeira tela, o app marca a atualização como falha, busca uma correção e, se não houver, volta para uma atualização anterior que abriu bem ou para o JS embutido no APK. Passada a primeira tela, ele não reverte sozinho. Na prática: o CI (lint, tipos, testes) é a rede de segurança; se algo ruim sair, publique um commit corrigindo.
- **Servidor pareado diferente do `ORBITA_PUBLIC_URL`:** o app não checa atualização. Ele continua funcionando normalmente com o JS que já tem.
- **Atualização antiga (replay):** o manifesto assinado não expira. Quem controla o servidor pode servir uma atualização antiga **assinada por você**, nunca uma criada por ele. O app sempre roda a atualização de `createdAt` mais recente que ele já tem, então isso só atinge quem ainda não baixou a mais nova.
- **Chave privada vazou (ou certificado vencendo):** gere um par novo (passos 1 a 4), troque o segredo e o certificado e construa um APK novo (o conteúdo do certificado entra no `runtimeVersion`, então o runtime muda). **Atenção:** os APKs que já estão instalados continuam confiando na chave **antiga** até você instalar o APK novo neles; quem tem a chave vazada pode assinar atualizações que esses aparelhos aceitam (precisando também do endereço do seu servidor, ou de um que o APK aceite). Por isso, depois de uma fuga, apague a chave antiga dos segredos, publique o APK novo e reinstale em todos os aparelhos o quanto antes; enquanto isso, o servidor ainda pode ser desligado das rotas `/updates` (ou a imagem publicada sem `ota/`) para não entregar nada. O CI avisa quando faltam menos de 90 dias para o certificado vencer.
- **Isolamento da chave no GitHub:** o `release.yml` tem três etapas em jobs separados. (1) `ota-prepare` roda `pnpm install`, Metro e plugins (código de terceiros) **sem nenhum segredo** e entrega só um artefato de dados. (2) `ota-sign` é o **único** job com `OTA_SIGNING_KEY`: faz checkout e usa o Node, **sem** `pnpm install` e **sem** cache, e roda o `packages/ota` (sem dependências) sobre o artefato, tratado como dado não confiável. (3) A imagem baixa só o `ota/` já assinado, sem a chave. O segredo do webhook do Dokploy só existe no passo que o usa. Limite honesto: a assinatura atesta que o build saiu do pipeline, não que o bundle exportado seja bom; um build comprometido em `ota-prepare` ainda poderia gerar um bundle ruim, mas não consegue ler a chave nem assinar por conta própria.
- **Falha do OTA não derruba o servidor:** se exportar ou assinar falhar, aparece um `::error::` no run e a imagem do servidor sai mesmo assim, sem `ota/` (o servidor responde "sem atualização"). Re-execução de uma release antiga (commit que não é mais a ponta da `main`) publica a imagem só com a tag do commit: sem `latest`, sem aviso ao Dokploy e sem OTA.
- **Gasto de rede:** o app baixa só o que mudou (arquivos têm o hash no nome e são imutáveis) e o servidor limita pedidos por IP (60 consultas e 600 arquivos a cada 10 minutos).

### Referências (Expo SDK 58)

- Protocolo: [Expo Updates v1](https://docs.expo.dev/technical-specs/expo-updates-1/) (cabeçalhos, manifesto, multipart, `expo-signature`, 204 como "sem atualização").
- Assinatura: [Code signing](https://docs.expo.dev/eas-update/code-signing/) (certificado autoassinado com uso `digitalSignature` + `codeSigning`, `rsa-v1_5-sha256`, `keyid`) e o gerador `expo-updates codesigning:generate`.
- Configuração: [`expo-updates`](https://docs.expo.dev/versions/latest/sdk/updates/) (`updates.url`, `checkAutomatically`, `runtimeVersion` com policy `fingerprint`). A troca do endereço em tempo de execução ([override](https://docs.expo.dev/eas-update/override/)) foi descartada porque exige `disableAntiBrickingMeasures`.

### Conferir à mão

```bash
curl -i https://seu-dominio/updates/manifest \
  -H "expo-protocol-version: 1" -H "expo-platform: android" \
  -H "expo-runtime-version: <runtimeVersion do APK>"
```

`200` com um corpo `multipart/mixed` e o cabeçalho `expo-signature` na parte `manifest` = há atualização; `204` = sem atualização para esse `runtimeVersion` (ou imagem sem OTA).

### Testar o caminho completo no seu computador

O certificado real já está em `apps/mobile/certs/`; não o toque. Use uma chave e um certificado de teste noutra pasta e passe o certificado de teste ao CLI (ele só serve para conferir a assinatura):

```bash
pnpm --filter @orbita/mobile exec expo-updates codesigning:generate --key-output-directory /tmp/k --certificate-output-directory /tmp/c --certificate-validity-duration-years 1 --certificate-common-name teste
ORBITA_PUBLIC_URL=https://localhost.exemplo.dev pnpm ota build --work /tmp/ota-work --out /tmp/ota-out \
  --base-url https://localhost.exemplo.dev --key-file /tmp/k/private-key.pem --certificate /tmp/c/certificate.pem
OTA_DIR=/tmp/ota-out pnpm dev:api   # e confira com o curl acima (runtime em /tmp/ota-work/runtime-version.txt)
git status --short apps/mobile/certs   # deve estar vazio
```

Se tiver mexido no certificado por engano: `git restore apps/mobile/certs/ota-certificate.pem`.

## VPS sem painel

Precisa de Docker, um domínio apontando para a VPS e as portas 80 e 443 abertas. O Caddy cuida do HTTPS.

```bash
git clone https://github.com/ali-ali18/orbita && cd orbita
cp .env.example .env        # preencha POSTGRES_PASSWORD, REDIS_PASSWORD (openssl rand -hex 32), APP_SECRET e DOMAIN
docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d
docker compose logs -f api  # o código de pareamento aparece aqui
```

Também dá para gerar um código na mão: `docker compose exec api parear`.

Atualizar: `docker compose pull && docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d`.

## Desenvolvimento local

Precisa de Node 22.18+, pnpm 10, Postgres 16 e Redis 7.

```bash
pnpm install
cp .env.example .env      # use o bloco "desenvolvimento local"
pnpm db:migrate
pnpm dev:api              # em um terminal (mostra o código de pareamento)
pnpm dev:worker           # em outro
```

Testes do banco contra um Postgres descartável:

```bash
DATABASE_URL_TEST=postgresql://orbita:orbita@localhost:5432/orbita_test pnpm test
```
