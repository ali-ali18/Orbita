import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { readExport, writeOtaDir } from "./bundle.ts";
import { formatSignatureHeader, type OtaPlatform } from "./layout.ts";
import { buildManifest } from "./manifest.ts";
import { loadPrivateKey, readCertificate, signManifest, verifyManifestSignature } from "./sign.ts";

const run = promisify(execFile);

/** Arquivos que o passo `prepare` deixa na pasta de trabalho e o `sign` lê. */
export const WORK_FILES = {
	dist: "dist",
	runtimeVersion: "runtime-version.txt",
	expoConfig: "expo-config.json",
	codeSigning: "code-signing.json",
} as const;

const MOBILE = "@orbita/mobile";

async function pnpm(repoRoot: string, args: string[]): Promise<string> {
	const { stdout } = await run("pnpm", args, { cwd: repoRoot, maxBuffer: 256 * 1024 * 1024 });
	return stdout;
}

/** Último JSON que a saída contém (o Expo imprime avisos e, às vezes, o JSON numa linha só). */
function lastJsonObject(output: string): unknown {
	const line = output
		.split("\n")
		.map((l) => l.trim())
		.reverse()
		.find((l) => l.startsWith("{") && l.endsWith("}"));
	if (!line) throw new Error("Não achei JSON na saída do comando.");
	return JSON.parse(line);
}

/** O runtimeVersion que o app (policy `fingerprint`) calcula para esta árvore de arquivos. */
export async function resolveRuntimeVersion(repoRoot: string, platform: OtaPlatform): Promise<string> {
	const out = await pnpm(repoRoot, [
		"--filter",
		MOBILE,
		"exec",
		"expo-updates",
		"runtimeversion:resolve",
		"--platform",
		platform,
	]);
	const { runtimeVersion } = lastJsonObject(out) as { runtimeVersion?: unknown };
	if (typeof runtimeVersion !== "string" || !runtimeVersion) {
		throw new Error("Não consegui resolver o runtimeVersion do app.");
	}
	return runtimeVersion;
}

/**
 * Passo 1 (SEM segredos): exporta o JS, descobre o runtimeVersion e a config pública.
 * Roda o código do projeto (Metro, plugins, app.config.ts), por isso nunca vê a chave de assinatura.
 */
export async function prepare(opts: {
	repoRoot: string;
	work: string;
	platform: OtaPlatform;
}): Promise<void> {
	const { repoRoot, work, platform } = opts;
	await mkdir(work, { recursive: true });
	await pnpm(repoRoot, [
		"--filter",
		MOBILE,
		"exec",
		"expo",
		"export",
		"--platform",
		platform,
		"--output-dir",
		join(work, WORK_FILES.dist),
	]);
	const runtimeVersion = await resolveRuntimeVersion(repoRoot, platform);
	await writeFile(join(work, WORK_FILES.runtimeVersion), runtimeVersion);
	const config = await pnpm(repoRoot, [
		"--filter",
		MOBILE,
		"exec",
		"expo",
		"config",
		"--type",
		"public",
		"--json",
	]);
	await writeFile(join(work, WORK_FILES.expoConfig), JSON.stringify(lastJsonObject(config)));
	// A config "pública" esconde o bloco de code signing; o keyid vem da config completa (não tem segredo nela).
	const full = lastJsonObject(
		await pnpm(repoRoot, ["--filter", MOBILE, "exec", "expo", "config", "--json"]),
	) as {
		updates?: { codeSigningMetadata?: unknown };
	};
	await writeFile(
		join(work, WORK_FILES.codeSigning),
		JSON.stringify(full.updates?.codeSigningMetadata ?? null),
	);
}

export type SignOptions = {
	work: string;
	out: string;
	platform: OtaPlatform;
	baseUrl: string;
	/** PEM da chave privada RSA. */
	privateKeyPem: string;
	/** PEM do certificado embutido no app: a assinatura é conferida contra ele antes de gravar. */
	certificatePem: string;
	now: Date;
	createdAt?: string;
};

export type SignResult = { id: string; runtimeVersion: string; assets: number; warnings: string[] };

const DAY_MS = 24 * 60 * 60 * 1000;

function keyIdOf(codeSigning: unknown): string {
	const keyid = (codeSigning as { keyid?: unknown } | null)?.keyid;
	if (typeof keyid !== "string" || !keyid) {
		throw new Error(
			"A config do app não tem updates.codeSigningMetadata.keyid (falta o certificado em apps/mobile/certs?).",
		);
	}
	return keyid;
}

/** Passo 2 (COM a chave): monta o manifesto, assina, confere contra o certificado e grava o diretório OTA. */
export async function signOta(opts: SignOptions): Promise<SignResult> {
	const warnings: string[] = [];
	const runtimeVersion = (await readFile(join(opts.work, WORK_FILES.runtimeVersion), "utf8")).trim();
	const expoClient = JSON.parse(await readFile(join(opts.work, WORK_FILES.expoConfig), "utf8")) as Record<
		string,
		unknown
	>;
	const keyId = keyIdOf(JSON.parse(await readFile(join(opts.work, WORK_FILES.codeSigning), "utf8")));

	const exported = await readExport(join(opts.work, WORK_FILES.dist), opts.platform);
	const built = buildManifest({
		runtimeVersion,
		createdAt: opts.createdAt ?? opts.now.toISOString(),
		baseUrl: opts.baseUrl,
		launch: exported.launch,
		assets: exported.assets,
		expoClient,
	});

	const signature = signManifest(built.json, loadPrivateKey(opts.privateKeyPem));
	const certificate = readCertificate(opts.certificatePem);
	if (!verifyManifestSignature(built.json, signature, certificate.publicKey)) {
		throw new Error(
			"A chave privada não corresponde ao certificado do app (apps/mobile/certs/ota-certificate.pem). O app rejeitaria a atualização.",
		);
	}
	if (opts.now < certificate.notBefore || opts.now > certificate.notAfter) {
		throw new Error(
			`O certificado do app está fora da validade (${certificate.notBefore.toISOString()} a ${certificate.notAfter.toISOString()}).`,
		);
	}
	const daysLeft = Math.floor((certificate.notAfter.getTime() - opts.now.getTime()) / DAY_MS);
	if (daysLeft < 90)
		warnings.push(`O certificado de assinatura vence em ${daysLeft} dias: gere um novo (docs/servidor.md).`);

	await writeOtaDir({
		outDir: opts.out,
		platform: opts.platform,
		built,
		signatureHeader: formatSignatureHeader({ signature, keyId }),
	});
	return { id: built.manifest.id, runtimeVersion, assets: built.files.length, warnings };
}
