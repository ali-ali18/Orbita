import { describe, expect, it, vi } from "vitest";
import { createUpdateChecker, isSameServer, type UpdatesPort } from "./updates.ts";

function fakePort(over: Partial<UpdatesPort> = {}) {
	return {
		isEnabled: true,
		check: vi.fn(async () => ({ isAvailable: true })),
		download: vi.fn(async () => ({ isNew: true })),
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

	it("nunca lança: erro vira 'error' e o intervalo é respeitado", async () => {
		const port = fakePort({
			check: vi.fn(async () => {
				throw new Error("rede");
			}),
		});
		const c = checker(port, { now: () => 0 });
		expect(await c.run(BASE)).toBe("error");
		expect(await c.run(BASE)).toBe("throttled");
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
