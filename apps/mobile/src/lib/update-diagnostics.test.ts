import { describe, expect, it } from "vitest";
import {
	type AppUpdateSnapshot,
	formatAppUpdate,
	nativeErrorLine,
	runResultLabel,
} from "./update-diagnostics.ts";

const RUNTIME = "2740e9eb100a0817da683d3f513787992ae0b710";
const base: AppUpdateSnapshot = {
	apkVersion: "0.1.0+90428ca",
	apkBuild: "1142",
	jsVersion: "0.1.0+90428ca",
	enabled: true,
	runtimeVersion: RUNTIME,
	updateId: "915a7a65-03bf-4b88-8a74-3ae12e8cc3ee",
	createdAt: "2026-11-10T00:59:23.670Z",
	isEmbeddedLaunch: true,
	channel: null,
	emergencyLaunchReason: null,
	otaUpdateUrl: "https://financas.exemplo.dev/updates/manifest",
	pairedBaseUrl: "https://financas.exemplo.dev",
	last: null,
	pending: false,
	server: undefined,
	nativeErrors: [],
};
const offer = {
	id: "7424256b-5e41-4a79-96b7-407ec7f7b4de",
	runtimeVersion: RUNTIME,
	createdAt: "2026-11-10T13:40:21.284Z",
};
const text = (over: Partial<AppUpdateSnapshot> = {}) => formatAppUpdate({ ...base, ...over });

describe("formatAppUpdate", () => {
	it("mostra o APK, o JS embutido, o runtime e só o host dos endereços", () => {
		expect(text()).toBe(
			[
				"APK instalado: 0.1.0+90428ca (código 1142)",
				"JavaScript em uso: 0.1.0+90428ca · o que veio no APK (atualização 915a7a65 de 9 de nov às 21:59)",
				"Atualização por OTA: ligada",
				`runtimeVersion do APK: ${RUNTIME}`,
				"Endereço de atualização no APK: financas.exemplo.dev",
				"Servidor pareado: financas.exemplo.dev (o mesmo do APK)",
				"Servidor oferece: não informado (sem resposta ou servidor antigo)",
				"Última checagem: ainda não conferiu desde que o app abriu",
			].join("\n"),
		);
	});

	it("JS baixado do servidor aparece como baixado, com a versão do commit", () => {
		expect(
			text({
				isEmbeddedLaunch: false,
				jsVersion: "0.1.0+5536324",
				updateId: offer.id,
				createdAt: offer.createdAt,
			}),
		).toContain(
			"JavaScript em uso: 0.1.0+5536324 · baixado do servidor (atualização 7424256b de 10 de nov às 10:40)",
		);
	});

	it("servidor pareado diferente do APK é dito com todas as letras", () => {
		expect(text({ pairedBaseUrl: "https://192.168.0.10:3000" })).toContain(
			"Servidor pareado: 192.168.0.10:3000 (DIFERENTE do APK: o app não confere atualização)",
		);
		expect(text({ pairedBaseUrl: null })).toContain("Servidor pareado: nenhum");
		expect(text({ otaUpdateUrl: null, enabled: false })).toContain("Endereço de atualização no APK: nenhum");
	});

	it("compara o que o servidor oferece com o que o app roda", () => {
		expect(text({ server: null })).toContain(
			"Servidor oferece: nenhuma atualização (imagem publicada sem OTA)",
		);
		expect(text({ server: offer })).toContain(
			`Servidor oferece: atualização 7424256b de 10 de nov às 10:40, runtime ${RUNTIME} · mais nova que a do app: toque em "Procurar atualização agora"`,
		);
		expect(text({ server: { ...offer, runtimeVersion: "outro-runtime" } })).toContain(
			"DIFERENTE do runtime deste APK: ele não recebe essa atualização, instale o APK novo",
		);
		expect(text({ server: offer, updateId: offer.id.toUpperCase(), createdAt: offer.createdAt })).toContain(
			"é a que o app está rodando",
		);
		expect(text({ server: { ...offer, createdAt: "2026-11-09T12:00:00.000Z" } })).toContain(
			"mais antiga que a do app (o APK é mais novo), não será baixada",
		);
	});

	it("mostra a última checagem com hora, o erro e a atualização pendente", () => {
		const at = Date.parse("2026-11-10T13:52:00.000Z");
		expect(text({ last: { result: "downloaded", at, error: null }, pending: true })).toContain(
			"Última checagem: 10 de nov às 10:52 · atualização baixada; feche e abra o app para aplicar",
		);
		expect(text({ last: { result: "error", at, error: "HTTP 502" } })).toContain(
			"Última checagem: 10 de nov às 10:52 · falhou: HTTP 502",
		);
		expect(text({ last: { result: "up-to-date", at, error: null }, pending: true })).toContain(
			"nenhuma atualização nova · há uma atualização baixada esperando o app reiniciar",
		);
	});

	it("canal, modo de emergência e erros nativos só aparecem quando existem", () => {
		const out = text({
			channel: "producao",
			emergencyLaunchReason: "banco de dados ilegível",
			nativeErrors: ["10 de nov às 10:52 · Failed to download remote update"],
		});
		expect(out).toContain("Canal: producao");
		expect(out).toContain("Abriu em modo de emergência: banco de dados ilegível");
		expect(out).toContain(
			"Erros recentes do atualizador:\n- 10 de nov às 10:52 · Failed to download remote update",
		);
		expect(text()).not.toContain("Canal");
	});
});

describe("textos auxiliares", () => {
	it("todo resultado tem frase em pt-BR", () => {
		expect(runResultLabel("downloaded")).toBe("atualização baixada; feche e abra o app para aplicar");
		expect(runResultLabel("other-server")).toContain("não é o do APK");
		expect(runResultLabel("throttled")).toContain("15 minutos");
	});

	it("erro nativo vira uma linha só, cortada", () => {
		const line = nativeErrorLine({
			timestamp: Date.parse("2026-11-10T13:52:00.000Z"),
			message: `Falha\n  ao baixar ${"x".repeat(400)}`,
		});
		expect(line.startsWith("10 de nov às 10:52 · Falha ao baixar x")).toBe(true);
		expect(line.length).toBeLessThanOrEqual("10 de nov às 10:52 · ".length + 200);
	});
});
