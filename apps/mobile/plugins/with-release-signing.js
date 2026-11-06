// Config plugin: assinatura do APK de release no projeto gerado pelo `expo prebuild`.
//
// O template do Expo assina o release com o `debug.keystore` dele, que é PÚBLICO. Aqui o release
// passa a assinar só com o que o workflow fornece por variável de ambiente:
//   ORBITA_KEYSTORE_FILE, ORBITA_KEYSTORE_PASSWORD, ORBITA_KEY_ALIAS, ORBITA_KEY_PASSWORD
// Sem elas, o build de release FALHA (não há fallback para o keystore de debug). O build de debug
// não é afetado. Nenhum segredo é escrito no build.gradle: ele só lê o ambiente.
const { withAppBuildGradle } = require("expo/config-plugins");

const RELEASE_SIGNING = `
        release {
            if (System.getenv('ORBITA_KEYSTORE_FILE')) {
                storeFile file(System.getenv('ORBITA_KEYSTORE_FILE'))
                storePassword System.getenv('ORBITA_KEYSTORE_PASSWORD')
                keyAlias System.getenv('ORBITA_KEY_ALIAS')
                keyPassword System.getenv('ORBITA_KEY_PASSWORD')
            }
        }`;

// Falha cedo e com mensagem clara se alguém pedir um release sem chave.
const REQUIRE_KEYSTORE = `

// Órbita: release exige chave de assinatura fornecida pelo ambiente (sem fallback para debug).
gradle.taskGraph.whenReady { graph ->
    def pedeRelease = graph.allTasks.any { it.project == project && it.name.toLowerCase().contains('release') }
    if (pedeRelease) {
        ['ORBITA_KEYSTORE_FILE', 'ORBITA_KEYSTORE_PASSWORD', 'ORBITA_KEY_ALIAS', 'ORBITA_KEY_PASSWORD'].each {
            if (!System.getenv(it)) {
                throw new GradleException("Build de release sem chave de assinatura: defina \${it} (veja docs/app-android.md).")
            }
        }
    }
}
`;

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
		cfg.modResults.contents = comRelease + REQUIRE_KEYSTORE;
		return cfg;
	});
}

module.exports = withReleaseSigning;
