// Config plugin: assinatura do APK de release no projeto gerado pelo `expo prebuild`.
//
// O template do Expo assina o release com o `debug.keystore` dele (o mesmo em todo build, então
// as atualizações instalam por cima). Aqui o `signingConfig` de release passa a ler uma chave
// própria do ambiente, se existir, e cai no keystore do template se não existir:
//   ORBITA_KEYSTORE_FILE, ORBITA_KEYSTORE_PASSWORD, ORBITA_KEY_ALIAS, ORBITA_KEY_PASSWORD
// Os valores chegam por variável de ambiente (o workflow decodifica o keystore em disco temporário);
// nada de segredo é escrito no build.gradle.
const { withAppBuildGradle } = require("expo/config-plugins");

const RELEASE_SIGNING = `
        release {
            if (System.getenv('ORBITA_KEYSTORE_FILE')) {
                storeFile file(System.getenv('ORBITA_KEYSTORE_FILE'))
                storePassword System.getenv('ORBITA_KEYSTORE_PASSWORD')
                keyAlias System.getenv('ORBITA_KEY_ALIAS')
                keyPassword System.getenv('ORBITA_KEY_PASSWORD')
            } else {
                storeFile file('debug.keystore')
                storePassword 'android'
                keyAlias 'androiddebugkey'
                keyPassword 'android'
            }
        }`;

function withReleaseSigning(config) {
	return withAppBuildGradle(config, (cfg) => {
		const gradle = cfg.modResults.contents;
		if (gradle.includes("ORBITA_KEYSTORE_FILE")) return cfg;

		// 1. Declara signingConfigs.release logo depois do bloco `signingConfigs {`.
		const comSigning = gradle.replace(/signingConfigs \{/, `signingConfigs {${RELEASE_SIGNING}`);
		// 2. O buildType release deixa de apontar para o debug.
		const comRelease = comSigning.replace(
			/(release \{\s*\/\/ Caution![^\n]*\n[^\n]*\n\s*)signingConfig signingConfigs\.debug/,
			"$1signingConfig signingConfigs.release",
		);
		if (comSigning === gradle || comRelease === comSigning) {
			throw new Error(
				"with-release-signing: o build.gradle do template mudou; ajuste plugins/with-release-signing.js.",
			);
		}
		cfg.modResults.contents = comRelease;
		return cfg;
	});
}

module.exports = withReleaseSigning;
