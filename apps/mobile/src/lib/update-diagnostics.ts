/*
 * Bloco "Atualização do app" do Diagnóstico: o que o dono precisa enxergar para saber por que uma atualização
 * OTA chegou ou não (docs/servidor.md, "Atualizar o app sem APK"). Só texto, montado por funções puras.
 */
import { dayMonth, saoPauloStamp } from "./format.ts";
import { isSameServer, type UpdateCheckRecord, type UpdateRunResult } from "./updates.ts";

export const APP_UPDATE_TITLE = "Atualização do app";

/** O que o servidor diz que está oferecendo (`GET /v1/server`). */
export type ServerOffer = { id: string; runtimeVersion: string; createdAt: string | null };

export type AppUpdateSnapshot = {
	/** versionName e versionCode do APK instalado (o JS pode ser mais novo que o APK). */
	apkVersion: string | null;
	apkBuild: string | null;
	/** Versão do JavaScript em uso (`0.1.0+<commit>`): muda quando uma atualização OTA entra. */
	jsVersion: string | null;
	enabled: boolean;
	runtimeVersion: string | null;
	updateId: string | null;
	/** ISO 8601. */
	createdAt: string | null;
	isEmbeddedLaunch: boolean;
	channel: string | null;
	emergencyLaunchReason: string | null;
	/** Endereço de atualização embutido no APK (`extra.otaUpdateUrl`). */
	otaUpdateUrl: string | null;
	pairedBaseUrl: string | null;
	last: UpdateCheckRecord | null;
	pending: boolean;
	/** `null` = o servidor não tem atualização; `undefined` = não respondeu ou é um servidor antigo. */
	server: ServerOffer | null | undefined;
	/** Últimos erros do registro nativo do expo-updates, já em texto. */
	nativeErrors: readonly string[];
};

const RESULT_LABEL: Record<UpdateRunResult, string> = {
	disabled: "atualização desligada neste APK (sem certificado ou sem endereço no build)",
	"no-server": "sem servidor pareado, nada foi conferido",
	"other-server": "o servidor pareado não é o do APK, nada foi conferido",
	throttled: "conferido há pouco, esperando o intervalo de 15 minutos",
	"up-to-date": "nenhuma atualização nova",
	downloaded: "atualização baixada; feche e abra o app para aplicar",
	error: "falhou",
};

/** Frase do resultado de uma checagem, para o botão "Procurar atualização agora" e para o relatório. */
export function runResultLabel(result: UpdateRunResult): string {
	return RESULT_LABEL[result];
}

function hostOf(url: string | null): string | null {
	if (!url) return null;
	try {
		return new URL(url).host.toLowerCase() || null;
	} catch {
		return null;
	}
}

function when(iso: string | null): string | null {
	const stamp = iso ? saoPauloStamp(iso) : null;
	return stamp ? `${dayMonth(stamp.date)} às ${stamp.time}` : null;
}

const shortId = (id: string) => id.slice(0, 8);
const dated = (iso: string | null) => {
	const text = when(iso);
	return text ? ` de ${text}` : "";
};

function runningLine(s: AppUpdateSnapshot): string {
	const version = s.jsVersion ? `${s.jsVersion} · ` : "";
	if (!s.updateId) return `JavaScript em uso: ${version}o que veio no APK`;
	const origin = s.isEmbeddedLaunch ? "o que veio no APK" : "baixado do servidor";
	return `JavaScript em uso: ${version}${origin} (atualização ${shortId(s.updateId)}${dated(s.createdAt)})`;
}

function serverLine(s: AppUpdateSnapshot): string {
	if (s.server === undefined) return "Servidor oferece: não informado (sem resposta ou servidor antigo)";
	if (s.server === null) return "Servidor oferece: nenhuma atualização (imagem publicada sem OTA)";
	const offer = `atualização ${shortId(s.server.id)}${dated(s.server.createdAt)}, runtime ${s.server.runtimeVersion}`;
	if (!s.runtimeVersion) return `Servidor oferece: ${offer}`;
	if (s.server.runtimeVersion !== s.runtimeVersion) {
		return `Servidor oferece: ${offer} · DIFERENTE do runtime deste APK: ele não recebe essa atualização, instale o APK novo`;
	}
	if (s.updateId && s.server.id.toLowerCase() === s.updateId.toLowerCase()) {
		return `Servidor oferece: ${offer} · é a que o app está rodando`;
	}
	const offered = s.server.createdAt ? Date.parse(s.server.createdAt) : Number.NaN;
	const running = s.createdAt ? Date.parse(s.createdAt) : Number.NaN;
	if (!Number.isNaN(offered) && !Number.isNaN(running) && offered <= running) {
		return `Servidor oferece: ${offer} · mais antiga que a do app (o APK é mais novo), não será baixada`;
	}
	return `Servidor oferece: ${offer} · mais nova que a do app: toque em "Procurar atualização agora"`;
}

function lastCheckLine(last: UpdateCheckRecord | null, pending: boolean): string {
	if (!last) return "Última checagem: ainda não conferiu desde que o app abriu";
	const at = when(new Date(last.at).toISOString());
	const detail = last.result === "error" && last.error ? `falhou: ${last.error}` : RESULT_LABEL[last.result];
	const waiting =
		pending && last.result !== "downloaded" ? " · há uma atualização baixada esperando o app reiniciar" : "";
	return `Última checagem: ${at ? `${at} · ` : ""}${detail}${waiting}`;
}

function pairedLine(s: AppUpdateSnapshot, otaHost: string | null): string {
	const pairedHost = hostOf(s.pairedBaseUrl);
	if (!pairedHost) return "Servidor pareado: nenhum";
	if (!otaHost) return `Servidor pareado: ${pairedHost}`;
	const same = s.pairedBaseUrl !== null && isSameServer(s.pairedBaseUrl, s.otaUpdateUrl);
	return `Servidor pareado: ${pairedHost} ${
		same ? "(o mesmo do APK)" : "(DIFERENTE do APK: o app não confere atualização)"
	}`;
}

/** O bloco inteiro, uma informação por linha. Entra na tela e no "Copiar como texto". */
export function formatAppUpdate(s: AppUpdateSnapshot): string {
	const apk = [s.apkVersion, s.apkBuild ? `(código ${s.apkBuild})` : null].filter(Boolean).join(" ");
	const otaHost = hostOf(s.otaUpdateUrl);
	const lines = [
		`APK instalado: ${apk || "não informado"}`,
		runningLine(s),
		`Atualização por OTA: ${s.enabled ? "ligada" : "desligada neste APK"}`,
		`runtimeVersion do APK: ${s.runtimeVersion ?? "não informado"}`,
		...(s.channel ? [`Canal: ${s.channel}`] : []),
		`Endereço de atualização no APK: ${otaHost ?? "nenhum"}`,
		pairedLine(s, otaHost),
		serverLine(s),
		lastCheckLine(s.last, s.pending),
		...(s.emergencyLaunchReason ? [`Abriu em modo de emergência: ${s.emergencyLaunchReason}`] : []),
		...(s.nativeErrors.length > 0
			? ["Erros recentes do atualizador:", ...s.nativeErrors.map((e) => `- ${e}`)]
			: []),
	];
	return lines.join("\n");
}

/** Linha de um erro do registro nativo: "10 de nov às 10:52 · mensagem" (mensagem cortada em 200 caracteres). */
export function nativeErrorLine(entry: { timestamp: number; message: string }): string {
	const at = when(new Date(entry.timestamp).toISOString());
	const message = entry.message.replace(/\s+/g, " ").trim().slice(0, 200);
	return at ? `${at} · ${message}` : message;
}
