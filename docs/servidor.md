# Servidor

Como subir o Órbita numa VPS e parear o celular.

## Requisitos

- Uma VPS com Docker e Docker Compose.
- Um domínio apontando para o IP da VPS (registro A). O Caddy tira o certificado HTTPS sozinho.
- Portas 80 e 443 abertas.

## Subir

```bash
git clone https://github.com/ali-ali18/orbita && cd orbita
cp .env.example .env
# Preencha no .env: POSTGRES_PASSWORD, APP_SECRET e DOMAIN
openssl rand -base64 24   # para POSTGRES_PASSWORD
openssl rand -base64 48   # para APP_SECRET
docker compose up -d --build
```

O serviço `migrate` aplica as migrações do banco antes da API e do worker subirem.

Conferir:

```bash
docker compose ps
curl https://SEU_DOMINIO/health   # {"ok":true}
```

## Parear o celular

```bash
docker compose exec api parear
```

O comando mostra um código de 6 números que vale por **10 minutos** e **uma vez só**. Gerar outro invalida o anterior. Cinco tentativas erradas matam o código.

No app, digite o endereço do servidor e o código. O aparelho recebe um token próprio; o servidor guarda só o hash dele. Para desconectar um aparelho, use _Configurações → Sair deste aparelho_.

## Atualizar

```bash
git pull
docker compose up -d --build
```

## Desenvolvimento local

Precisa de Node 22.18+, pnpm 10, Postgres 16 e Redis 7.

```bash
pnpm install
cp .env.example .env      # ajuste DATABASE_URL, REDIS_URL e APP_SECRET
pnpm db:migrate
pnpm dev:api              # em um terminal
pnpm dev:worker           # em outro
pnpm parear
```

Testes do banco contra um Postgres descartável:

```bash
DATABASE_URL_TEST=postgresql://orbita:orbita@localhost:5432/orbita_test pnpm test
```
