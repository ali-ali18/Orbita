import { NOTIFICATION_BANK_PACKAGES } from "@orbita/shared";
import { describe, expect, it } from "vitest";
import {
	ago,
	captureView,
	deliveryLine,
	inboxCaption,
	isVerifiedApp,
	type NativeStatus,
	packagesFor,
} from "./capture-model.ts";

const ok: NativeStatus = { granted: true, queued: 0, lastSentAt: 0, lastError: null, authFailed: false };

describe("packagesFor", () => {
	it("traduz os bancos ligados para pacotes Android, só os da lista", () => {
		expect(packagesFor(["nubank", "inter"])).toEqual([
			...NOTIFICATION_BANK_PACKAGES.nubank,
			...NOTIFICATION_BANK_PACKAGES.inter,
		]);
		expect(packagesFor([])).toEqual([]);
	});

	it("marca quais bancos têm formato conferido", () => {
		expect(isVerifiedApp("nubank")).toBe(true);
		expect(isVerifiedApp("bradesco")).toBe(false);
	});
});

describe("captureView", () => {
	const base = { supported: true, capture: true, apps: ["nubank" as const], status: ok };

	it("sem o módulo nativo avisa que é só no Android", () => {
		expect(captureView({ ...base, supported: false, status: null }).stage).toBe("unsupported");
	});

	it("desligada, sem acesso, sem banco e ativa", () => {
		expect(captureView({ ...base, capture: false }).stage).toBe("off");
		expect(captureView({ ...base, status: { ...ok, granted: false } }).stage).toBe("needs_access");
		expect(captureView({ ...base, apps: [] }).stage).toBe("needs_bank");
		const active = captureView(base);
		expect(active).toMatchObject({
			stage: "active",
			title: "Lendo as notificações de 1 banco",
			alert: false,
		});
		expect(captureView({ ...base, apps: ["nubank", "inter"] }).title).toBe(
			"Lendo as notificações de 2 bancos",
		);
	});

	it("a leitura do aparelho ainda não chegou: não finge que falta acesso", () => {
		expect(captureView({ ...base, status: null }).stage).toBe("active");
	});
});

describe("deliveryLine", () => {
	const NOW = 1_800_000_000_000;
	it("nada a dizer sem fila nem envio", () => {
		expect(deliveryLine(null, NOW)).toBeNull();
		expect(deliveryLine(ok, NOW)).toBeNull();
	});

	it("fila esperando rede, com o motivo", () => {
		expect(deliveryLine({ ...ok, queued: 1 }, NOW)).toBe("1 notificação espera rede para ir ao servidor.");
		expect(deliveryLine({ ...ok, queued: 3, lastError: "Sem conexão com o servidor." }, NOW)).toBe(
			"3 notificações esperam rede para ir ao servidor. Sem conexão com o servidor.",
		);
	});

	it("último envio e token recusado", () => {
		expect(deliveryLine({ ...ok, lastSentAt: NOW - 5 * 60_000 }, NOW)).toBe("Último envio há 5 min.");
		expect(deliveryLine({ ...ok, authFailed: true, queued: 2 }, NOW)).toMatch(/não reconhece mais/);
	});
});

describe("ago", () => {
	it("escolhe a unidade", () => {
		expect(ago(10_000)).toBe("agora há pouco");
		expect(ago(59 * 60_000)).toBe("há 59 min");
		expect(ago(3 * 3_600_000)).toBe("há 3 h");
		expect(ago(24 * 3_600_000)).toBe("há 1 dia");
		expect(ago(3 * 86_400_000)).toBe("há 3 dias");
		expect(ago(-5)).toBe("agora há pouco");
	});
});

describe("inboxCaption", () => {
	it("banco, motivo e horário", () => {
		const now = Date.parse("2026-11-15T15:00:00Z");
		expect(inboxCaption({ app: "nubank", reason: "target", postedAt: "2026-11-15T14:00:00Z" }, now)).toBe(
			"Nubank · Não achei o cartão ou a conta · há 1 h",
		);
		expect(inboxCaption({ app: "inter", reason: "format", postedAt: "ruim" }, now)).toBe(
			"Inter · Não entendi o formato",
		);
	});
});
