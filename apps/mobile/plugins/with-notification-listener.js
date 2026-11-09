// Config plugin: declara no AndroidManifest do app o serviço que lê as notificações dos bancos
// (módulo local `modules/orbita-notifications`) e o job que reenvia a fila quando volta a rede.
//
// O serviço exige a permissão BIND_NOTIFICATION_LISTENER_SERVICE: só o sistema Android consegue ligar nele, e o
// acesso só vale depois de o dono ligar o app em Configurações › Acesso a notificações. Nenhuma permissão de
// "uses-permission" é pedida (o acesso a notificações não é uma permissão de execução).
const { withAndroidManifest } = require("expo/config-plugins");

const PACKAGE = "expo.modules.orbitanotifications";
const LISTENER = `${PACKAGE}.OrbitaNotificationListener`;
const FLUSH_JOB = `${PACKAGE}.FlushJobService`;

function withNotificationListener(config) {
	return withAndroidManifest(config, (cfg) => {
		const app = cfg.modResults.manifest.application?.[0];
		if (!app)
			throw new Error("AndroidManifest sem <application>: não dá para declarar o serviço de notificações.");
		const services = app.service ?? [];
		const has = (name) => services.some((s) => s.$?.["android:name"] === name);

		if (!has(LISTENER)) {
			services.push({
				$: {
					"android:name": LISTENER,
					"android:label": "Órbita",
					"android:exported": "true",
					"android:permission": "android.permission.BIND_NOTIFICATION_LISTENER_SERVICE",
				},
				"intent-filter": [
					{ action: [{ $: { "android:name": "android.service.notification.NotificationListenerService" } }] },
				],
			});
		}
		if (!has(FLUSH_JOB)) {
			services.push({
				$: {
					"android:name": FLUSH_JOB,
					"android:exported": "false",
					"android:permission": "android.permission.BIND_JOB_SERVICE",
				},
			});
		}
		app.service = services;
		return cfg;
	});
}

module.exports = withNotificationListener;
module.exports.LISTENER = LISTENER;
module.exports.FLUSH_JOB = FLUSH_JOB;
