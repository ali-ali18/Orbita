# App Android (APK)

O app é compilado pelo GitHub Actions (`.github/workflows/app-android.yml`), sem EAS e sem Play Store. A cada versão nova na `main` (depois do CI verde) sai um APK assinado, publicado num GitHub Release marcado como _latest_.

**Link fixo do APK mais novo:**

```
https://github.com/ali-ali18/Orbita/releases/latest/download/orbita.apk
```

## Instalar no celular

1. Abra o link acima no navegador do celular. O download começa sozinho.
2. Abra o arquivo baixado. Se o Android avisar que o navegador não pode instalar apps, toque em **Configurações** e ligue **Permitir desta fonte** (_instalar apps desconhecidos_) para esse navegador. Volte e toque em **Instalar**.
3. Para atualizar, repita com o mesmo link. A versão nova instala **por cima** da antiga e os dados do app ficam. Isso vale enquanto a chave de assinatura não mudar (veja abaixo).

Depois de instalar, pareie o app com o servidor como em [`servidor.md`](servidor.md#3-subir-e-parear).

## Como o build funciona

- **Pull request** que mexe em `apps/mobile`, `packages/{tokens,core,shared}` ou no workflow: só compila e guarda o APK como artefato do run (14 dias). Não publica e não usa segredos.
- **`main`** (CI verde, mesmas condições do `release.yml`) ou disparo manual na `main`: compila, assina e cria o release `app-v<versão>-<n>` com o arquivo `orbita.apk`, marcado como _latest_. O release da imagem do servidor (`release.yml`) só publica no GHCR e não cria GitHub Release, então não disputa o _latest_.
- Etapas: `expo prebuild --platform android` gera `apps/mobile/android/` (fica fora do git) e `./gradlew assembleRelease` compila. JDK 17, Android SDK 37, build-tools 37.0.0, NDK 27.1.12297006 (o que o React Native 0.88 pede).
- **Versão:** `versionCode` = `1000 + número do run` (sempre cresce, o Android só atualiza por cima se subir) e `versionName` = `version` do `app.json` + `+<sha curto>`. Vêm das variáveis `ORBITA_VERSION_CODE` e `ORBITA_VERSION_SUFFIX`, lidas por `apps/mobile/app.config.ts`. Para lançar uma "versão" nova de verdade, mude `version` no `app.json`.
- **Só arm64:** o APK leva só a arquitetura `arm64-v8a` (celulares modernos), o que deixa o build mais rápido e o arquivo menor. Para aparelhos de 32 bits, mude `ORBITA_ARCHS` no workflow para `armeabi-v7a,arm64-v8a`.
- **Assinatura:** o plugin `apps/mobile/plugins/with-release-signing.js` troca a assinatura de release do projeto gerado. Se `ORBITA_KEYSTORE_FILE` (e as senhas) existirem no ambiente, usa essa chave; senão usa o `debug.keystore` do template do Expo.
- Ícone e splash: `apps/mobile/assets/*.png`, gerados por `python3 apps/mobile/assets/gerar-icones.py` (precisa do Pillow) a partir do avatar da Órbita.

## Chave de assinatura

Sem segredos configurados, o APK é assinado com o keystore de debug do template do Expo. Ele é o mesmo em todo build, então as atualizações instalam por cima, mas é uma chave **pública**: qualquer pessoa consegue assinar um APK que o Android aceita como atualização do seu app. O workflow avisa isso (`::warning::`) a cada build.

### Trocar para uma chave privada

Em qualquer computador com Java (`keytool`):

```bash
keytool -genkeypair -v -storetype PKCS12 -keystore orbita-release.keystore \
  -alias orbita -keyalg RSA -keysize 4096 -validity 36500
base64 -w0 orbita-release.keystore > orbita-release.keystore.b64   # no macOS: base64 -i orbita-release.keystore
```

Em _Settings → Secrets and variables → Actions_ do repositório, crie os quatro segredos:

| Segredo                     | Valor                                             |
| --------------------------- | ------------------------------------------------- |
| `ANDROID_KEYSTORE_BASE64`   | conteúdo de `orbita-release.keystore.b64`         |
| `ANDROID_KEYSTORE_PASSWORD` | a senha do keystore                               |
| `ANDROID_KEY_ALIAS`         | `orbita` (o `-alias` usado)                       |
| `ANDROID_KEY_PASSWORD`      | a senha da chave (a mesma do keystore, em PKCS12) |

Guarde o `.keystore` e as senhas num cofre (gerenciador de senhas): **se perder a chave, não dá mais para atualizar o app por cima**. Apague o `.b64` e não commite nada disso (`*.keystore` e `*.jks` já estão no `.gitignore`).

> **Trocar a chave exige desinstalar o app uma vez.** O Android não deixa instalar por cima de um app assinado com outra chave. Desinstale a Órbita, instale o APK novo e pareie de novo com o servidor. Depois disso, as atualizações voltam a instalar por cima.

O passo "Conferir assinatura" do workflow imprime o certificado (SHA-256) do APK, útil para confirmar que a chave própria foi usada.
