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
4. Se o Android recusar a atualização com algo como **"app não instalado"** ou **"assinatura diferente"**, trate como **sinal de alerta**: não desinstale para contornar. Pode ser um APK que não saiu deste repositório. Confira que o release foi criado pelo GitHub Actions de `ali-ali18/Orbita` (aba _Releases_, autor `github-actions`) e baixe de novo pelo link fixo acima. Só desinstale se foi você quem trocou a chave de propósito (veja abaixo).

Depois de instalar, pareie o app com o servidor como em [`servidor.md`](servidor.md#3-subir-e-parear).

## Como o build funciona

- **Pull request** que mexe em `apps/mobile`, `packages/{tokens,core,shared}` ou no workflow: só compila e guarda o APK como artefato do run (14 dias). Não publica e não usa segredos. O APK de PR é assinado com uma chave **descartável** criada no próprio job (`keytool` + senha aleatória), então nunca instala por cima do app real.
- **`main`** (CI verde, mesmas condições do `release.yml`) ou disparo manual na `main`: compila, assina e cria o release `app-v<versão>-<n>` com o arquivo `orbita.apk`. No disparo manual o workflow antes confere que o CI passou para aquele commit. O release só é marcado como _latest_ se o commit ainda for a ponta da `main` (reexecução de um run antigo não troca o APK do link fixo); se o release da tag já existe, o job só avisa e termina. O release da imagem do servidor (`release.yml`) só publica no GHCR e não cria GitHub Release, então não disputa o _latest_.
- **Sem chave privada, não publica.** Se qualquer um dos quatro segredos `ANDROID_*` faltar, o job de `main` falha com uma mensagem em português. A única saída é a variável do repositório `ALLOW_DEBUG_SIGNING=true` (_Settings → Secrets and variables → Actions → Variables_), que assina com o keystore de debug **público** do Expo. É inseguro: qualquer pessoa consegue assinar um APK que o Android aceita como atualização do seu app. Use só para testar.
- Etapas: `expo prebuild --platform android` gera `apps/mobile/android/` (fica fora do git) e `./gradlew assembleRelease` compila. JDK 17; o compileSdk, as build-tools, o NDK e o cmake que o React Native 0.88 pede são baixados pelo Android Gradle Plugin (o workflow só instala as `platform-tools` e aceita as licenças).
- **Versão:** `versionCode` = `1000 + número do run` (sempre cresce, o Android só atualiza por cima se subir) e `versionName` = `version` do `app.json` + `+<sha curto>`. Vêm das variáveis `ORBITA_VERSION_CODE` e `ORBITA_VERSION_SUFFIX`, lidas por `apps/mobile/app.config.ts`. Para lançar uma "versão" nova de verdade, mude `version` no `app.json`.
- **Só arm64:** o APK leva só a arquitetura `arm64-v8a` (celulares modernos), o que deixa o build mais rápido e o arquivo menor. Para aparelhos de 32 bits, mude `ORBITA_ARCHS` no workflow para `armeabi-v7a,arm64-v8a`.
- **Assinatura:** o plugin `apps/mobile/plugins/with-release-signing.js` faz o release do projeto gerado assinar **só** com o que o workflow entrega nas variáveis `ORBITA_KEYSTORE_FILE`, `ORBITA_KEYSTORE_PASSWORD`, `ORBITA_KEY_ALIAS` e `ORBITA_KEY_PASSWORD`. Sem elas o `assembleRelease` falha; não existe fallback silencioso para o keystore de debug.
- Ícone e splash: `apps/mobile/assets/*.png`, gerados por `python3 apps/mobile/assets/gerar-icones.py` (precisa do Pillow) a partir do avatar da Órbita.

## Atualização OTA dentro do APK

O APK carrega duas coisas para receber atualizações de JavaScript do servidor pareado (veja [Atualizar o app sem APK](servidor.md#atualizar-o-app-sem-apk)):

- **O certificado público** `apps/mobile/certs/ota-certificate.pem`, que confere a assinatura de cada atualização, e o **endereço das atualizações** (`updates.url` = `${ORBITA_PUBLIC_URL}/updates/manifest`, da variável do repositório `ORBITA_PUBLIC_URL`, que o workflow passa ao build). Sem o certificado no repositório ou sem a variável, o `app.config.ts` desliga o OTA (`updates.enabled: false`) e o APK sai como antes.
- **O `runtimeVersion`**, a impressão digital do projeto nativo (`runtimeVersion: { policy: "fingerprint" }`). O passo "Fixar o runtimeVersion do OTA" do workflow calcula o valor com o mesmo comando do `release.yml` (`node packages/ota/src/cli.ts runtime-version`) e o passa ao Gradle em `EXPO_UPDATES_FINGERPRINT_OVERRIDE`, para APK e atualização nunca divergirem.

O app só checa atualização se o servidor pareado for o mesmo host de `ORBITA_PUBLIC_URL` (`apps/mobile/src/lib/updates.ts`). Sem servidor pareado, com outro servidor, em dev ou na web, nada é checado.

**Permissões do chat:** `expo-image-picker` pede `CAMERA` (só ao tocar em _Tirar foto_; a galeria usa o seletor do sistema) e `expo-speech-recognition` pede `RECORD_AUDIO` (só ao tocar no microfone). Os textos de justificativa em pt-BR ficam nos plugins do `app.json`. Foram acrescentados os módulos nativos `expo-image-picker`, `expo-image-manipulator` e `expo-speech-recognition`: **o primeiro APK com anexos e ditado exige instalar o APK novo** (o `runtimeVersion` muda, então o APK antigo continua funcionando, mas não recebe este JS por OTA).

## Leitura de notificações dos bancos

Módulo Expo local `apps/mobile/modules/orbita-notifications` (Kotlin, autolinkado) + plugin `plugins/with-notification-listener.js`, que declara no AndroidManifest o serviço `OrbitaNotificationListener` (permissão `BIND_NOTIFICATION_LISTENER_SERVICE`) e o job `FlushJobService`. Escolhido em vez de `react-native-android-notification-listener` (sem release desde 2022, módulo antigo e tarefa headless de JS): o serviço lê, filtra, cifra e envia **sem JavaScript**, então funciona com o app fechado.

- O dono liga em Configurações › Notificações do celular; o app abre Acesso a notificações do Android. Em APK instalado fora da loja (Android 13+) a chave pode vir esmaecida: Informações do app › ⋮ › Permitir configurações restritas.
- Sem rede, a fila cifrada espera e o `JobScheduler` reenvia quando a rede volta (e ao abrir o app).
- **Precisa de APK novo** (módulo nativo e serviço no manifesto; o `runtimeVersion` muda). Não testado em aparelho: ver riscos no relatório do PR.

**Precisa de APK novo** quando muda algo nativo (dependência nativa, versão do Expo/React Native, permissões, ícone, plugin, certificado OTA): o `runtimeVersion` muda e o APK antigo para de receber o JS novo, mas continua funcionando. Mudou só JS? Basta o merge na `main`.

## Chave de assinatura

O Android só atualiza um app por cima se o APK novo for assinado com a mesma chave do instalado. A chave é o que impede que outra pessoa distribua uma "atualização" falsa, então ela é **privada** e fica nos segredos do repositório.

### Criar a chave e cadastrar os segredos

Em qualquer computador com Java (`keytool`). Se preferir, peça ao assistente que gere a chave e diga o passo a passo dos segredos.

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

> **Se o app instalado foi assinado com outra chave** (por exemplo, um build antigo com a chave de debug), a primeira instalação com a chave nova exige desinstalar o app uma vez e parear de novo com o servidor. Faça isso só quando foi você quem trocou a chave. Se o erro de assinatura aparecer sem você ter mexido na chave, não desinstale: veja o aviso no passo 4 de "Instalar no celular".

O passo "Conferir assinatura" do workflow imprime o certificado (SHA-256) do APK, útil para confirmar que a chave própria foi usada.
