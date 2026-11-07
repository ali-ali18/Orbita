// Gera a atualização OTA assinada. Roda no GitHub Actions (e localmente, com chave de teste):
//
//   node packages/ota/src/cli.ts prepare --work <pasta>                      (sem segredos)
//   node packages/ota/src/cli.ts sign --work <pasta> --base-url <https://servidor> --out <ota>
//   node packages/ota/src/cli.ts build ...                                   (prepare + sign)
//   node packages/ota/src/cli.ts runtime-version                              (imprime o runtimeVersion do app)
//
// A chave privada vem de uma variável de ambiente (padrão OTA_SIGNING_KEY) ou de --key-file, e só
// o passo `sign` a lê. Veja docs/servidor.md, "Atualizar o app sem APK".
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { prepare, resolveRuntimeVersion, signOta } from "./pipeline.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const DEFAULT_CERTIFICATE = join(repoRoot, "apps/mobile/certs/ota-certificate.pem");
const PLATFORM = "android";

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		work: { type: "string" },
		out: { type: "string", default: join(repoRoot, "ota") },
		"base-url": { type: "string" },
		certificate: { type: "string", default: DEFAULT_CERTIFICATE },
		"key-env": { type: "string", default: "OTA_SIGNING_KEY" },
		"key-file": { type: "string" },
		"created-at": { type: "string" },
	},
});

function fail(message: string): never {
	console.error(`erro: ${message}`);
	process.exit(1);
}

async function readKey(): Promise<string> {
	if (values["key-file"]) return readFile(values["key-file"], "utf8");
	const name = values["key-env"] ?? "OTA_SIGNING_KEY";
	const fromEnv = process.env[name];
	if (!fromEnv) fail(`defina a variável ${name} (ou use --key-file) com a chave privada de assinatura.`);
	return fromEnv;
}

async function sign(work: string) {
	const baseUrl = values["base-url"] ?? fail("faltou --base-url (o endereço público do servidor).");
	const result = await signOta({
		work,
		out: values.out ?? fail("faltou --out."),
		platform: PLATFORM,
		baseUrl,
		privateKeyPem: await readKey(),
		certificatePem: await readFile(values.certificate ?? DEFAULT_CERTIFICATE, "utf8"),
		now: new Date(),
		...(values["created-at"] ? { createdAt: values["created-at"] } : {}),
	});
	for (const w of result.warnings) console.warn(`::warning::${w}`);
	console.log(
		`Atualização ${result.id} (runtime ${result.runtimeVersion}) assinada: ${result.assets} arquivos em ${values.out}`,
	);
}

const command = positionals[0];
if (command === "runtime-version") {
	// Só imprime o runtimeVersion (os workflows fixam o do APK no mesmo valor do OTA).
	console.log(await resolveRuntimeVersion(repoRoot, PLATFORM));
	process.exit(0);
}
const work = values.work ?? fail("faltou --work (pasta de trabalho).");
try {
	if (command === "prepare" || command === "build") await prepare({ repoRoot, work, platform: PLATFORM });
	if (command === "sign" || command === "build") await sign(work);
	if (command !== "prepare" && command !== "sign" && command !== "build") {
		fail("use um comando: prepare, sign, build ou runtime-version.");
	}
} catch (e) {
	fail(e instanceof Error ? e.message : String(e));
}
