import { describe, expect, it, vi } from "vitest";
import { createUpdateChecker, isSameServer, type UpdatesPort } from "./updates.ts";

function fakePort(over: Partial<UpdatesPort> = {}) {
	return {
		isEnabled: true,
		check: vi.fn(async () => ({ isAvailable: true })),
		download: vi.fn(async () => ({ isNew: true })),
		reload: vi.fn(async () => {}),
		...over,
	} satisfies UpdatesPort;
}

const BASE = "https://financas.exemplo.dev";
const OTA = "https://financas.exemplo.dev/updates/manifest";
const checker = (port: UpdatesPort, opts: Partial<Parameters<typeof createUpdateChecker>[1]> = {}) =>
	createUpdateChecker(port, { otaUpdateUrl: OTA, ...opts });

describe("isSameServer", () => {
	it("compara host e porta, sem diferenciar maiúsculas nem caminho", () => {
		expect(isSameServer(BASE, OTA)).toBe(true);
		expect(isSameServer("https://FINANCAS.exemplo.dev/", OTA)).toBe(true);
		expect(isSameServer("https://outro.exemplo.dev", OTA)).toBe(false);
		expect(isSameServer("https://financas.exemplo.dev:8443", OTA)).toBe(false);
		expect(isSameServer("lixo", OTA)).toBe(false);
		expect(isSameServer(BASE, null)).toBe(false);
	});
});

describe("createUpdateChecker", () => {
	it("desabilitado (dev, web, APK sem OTA): não faz nada", async () => {
		const port = fakePort({ isEnabled: false });
		expect(await checker(port).run(BASE)).toBe("disabled");
		expect(port.check).not.toHaveBeenCalled();
	});

	it("sem servidor pareado: não checa", async () => {
		const port = fakePort();
		expect(await checker(port).run(null)).toBe("no-server");
		expect(port.check).not.toHaveBeenCalled();
	});

	it("servidor pareado diferente do embutido no APK: não checa", async () => {
		const port = fakePort();
		expect(await checker(port).run("https://outro.exemplo.dev")).toBe("other-server");
		expect(await checker(port, { otaUpdateUrl: null }).run(BASE)).toBe("other-server");
		expect(port.check).not.toHaveBeenCalled();
	});

	it("mesmo servidor: confere e baixa (sem recarregar o app)", async () => {
		const port = fakePort();
		expect(await checker(port).run(BASE)).toBe("downloaded");
		expect(port.check).toHaveBeenCalledOnce();
		expect(port.download).toHaveBeenCalledOnce();
	});

	it("sem atualização nova: não baixa", async () => {
		const port = fakePort({ check: vi.fn(async () => ({ isAvailable: false })) });
		expect(await checker(port).run(BASE)).toBe("up-to-date");
		expect(port.download).not.toHaveBeenCalled();
	});

	it("baixou algo que já tinha: conta como em dia", async () => {
		const port = fakePort({ download: vi.fn(async () => ({ isNew: false })) });
		expect(await checker(port).run(BASE)).toBe("up-to-date");
	});

	it("não confere de novo antes do intervalo; depois do intervalo confere", async () => {
		let t = 0;
		const port = fakePort();
		const c = checker(port, { now: () => t, minIntervalMs: 1000 });
		await c.run(BASE);
		t = 999;
		expect(await c.run(BASE)).toBe("throttled");
		t = 1000;
		expect(await c.run(BASE)).toBe("downloaded");
		expect(port.check).toHaveBeenCalledTimes(2);
	});

	it("nunca lança: erro vira 'error', com a mensagem guardada para o Diagnóstico", async () => {
		const port = fakePort({
			check: vi.fn(async () => {
				throw new Error("rede");
			}),
		});
		const c = checker(port, { now: () => 5 });
		expect(await c.run(BASE)).toBe("error");
		expect(c.state().last).toEqual({ result: "error", at: 5, error: "rede" });
	});

	// Defeito real: o servidor reiniciando no redeploy devolvia erro e o app ficava 15 minutos sem tentar de novo.
	it("depois de um erro, tenta de novo em 1 minuto em vez de esperar o intervalo inteiro", async () => {
		let t = 0;
		const check = vi
			.fn<UpdatesPort["check"]>()
			.mockRejectedValueOnce(new Error("502"))
			.mockResolvedValue({ isAvailable: true });
		const c = checker(fakePort({ check }), { now: () => t });
		expect(await c.run(BASE)).toBe("error");
		t = 59_000;
		expect(await c.run(BASE)).toBe("throttled");
		t = 60_000;
		expect(await c.run(BASE)).toBe("downloaded");
	});

	it("'Procurar atualização agora' (force) ignora o intervalo", async () => {
		const port = fakePort({ check: vi.fn(async () => ({ isAvailable: false })) });
		const c = checker(port, { now: () => 0 });
		expect(await c.run(BASE)).toBe("up-to-date");
		expect(await c.run(BASE)).toBe("throttled");
		expect(await c.run(BASE, { force: true })).toBe("up-to-date");
		expect(port.check).toHaveBeenCalledTimes(2);
	});

	it("guarda a última checagem de verdade; 'throttled' não apaga o resultado anterior", async () => {
		let t = 100;
		const c = checker(fakePort({ check: vi.fn(async () => ({ isAvailable: false })) }), { now: () => t });
		expect(c.state()).toEqual({ last: null, pending: false });
		await c.run(BASE);
		t = 200;
		expect(await c.run(BASE)).toBe("throttled");
		expect(c.state().last).toEqual({ result: "up-to-date", at: 100, error: null });
	});

	it("chamadas simultâneas dividem uma execução só", async () => {
		const port = fakePort();
		const c = checker(port);
		expect(await Promise.all([c.run(BASE), c.run(BASE), c.run(BASE)])).toEqual([
			"downloaded",
			"downloaded",
			"downloaded",
		]);
		expect(port.check).toHaveBeenCalledOnce();
	});
});

// Defeito real (o dono abriu o app várias vezes e a interface continuou a antiga): a atualização era baixada, mas
// só entrava em uso num início a frio do processo, e no Android "abrir o app" quase sempre só o traz de volta.
describe("aplicar a atualização baixada", () => {
	it("depois de baixar, voltar ao primeiro plano reinicia o JavaScript na versão nova", async () => {
		const port = fakePort();
		const c = checker(port);
		expect(await c.run(BASE)).toBe("downloaded");
		expect(c.state().pending).toBe(true);
		expect(await c.applyPending()).toBe(true);
		expect(port.reload).toHaveBeenCalledOnce();
	});

	it("sem atualização baixada, não reinicia nada", async () => {
		const port = fakePort({ check: vi.fn(async () => ({ isAvailable: false })) });
		const c = checker(port);
		expect(await c.applyPending()).toBe(false);
		await c.run(BASE);
		expect(await c.applyPending()).toBe(false);
		expect(port.reload).not.toHaveBeenCalled();
	});

	it("se o reinício falhar, não lança e a atualização continua pendente", async () => {
		const port = fakePort({
			reload: vi.fn(async () => {
				throw new Error("falhou");
			}),
		});
		const c = checker(port);
		await c.run(BASE);
		expect(await c.applyPending()).toBe(false);
		expect(c.state().pending).toBe(true);
	});
});
