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

   Opcionais: `ORBITA_VERSION` (tag da imagem, padrão `latest`), `PAIRING_AUTO=false` (desliga o código automático), `TRUSTED_PROXY_HOPS=2` se houver Cloudflare na frente do Dokploy.

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
