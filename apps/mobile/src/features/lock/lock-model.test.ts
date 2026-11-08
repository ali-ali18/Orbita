import { describe, expect, it } from "vitest";
import {
	type AuthOutcome,
	type Availability,
	type BiometricPort,
	GRACE_MS,
	initialLockState,
	isCovered,
	type LockEvent,
	type LockState,
	lockReducer,
	MESSAGES,
	mapAuthResult,
	parsePreference,
	requestEnable,
	serializePreference,
	shouldLock,
} from "./lock-model.ts";

const run = (events: LockEvent[], from: LockState = initialLockState) => events.reduce(lockReducer, from);
const fail = (reason: "cancelled" | "failed" | "unavailable"): AuthOutcome => ({ success: false, reason });
const openAndEnabled = () =>
	run([
		{ type: "loaded", enabled: false },
		{ type: "enabled-changed", enabled: true },
	]);

describe("shouldLock", () => {
	it("respeita a tolerância", () => {
		expect(shouldLock(1000, 1000 + GRACE_MS - 1)).toBe(false);
		expect(shouldLock(1000, 1000 + GRACE_MS)).toBe(true);
	});
	it("relógio que andou para trás trava", () => {
		expect(shouldLock(5000, 4000)).toBe(true);
	});
	it("aceita tolerância própria", () => {
		expect(shouldLock(0, 10, 5)).toBe(true);
		expect(shouldLock(0, 4, 5)).toBe(false);
	});
});

describe("preferência", () => {
	it("só '1' liga", () => {
		expect(parsePreference("1")).toBe(true);
		expect(parsePreference("0")).toBe(false);
		expect(parsePreference(null)).toBe(false);
		expect(parsePreference("true")).toBe(false);
		expect(serializePreference(true)).toBe("1");
		expect(serializePreference(false)).toBe("0");
	});
});

describe("mapAuthResult", () => {
	it("traduz os erros do módulo", () => {
		expect(mapAuthResult({ success: true })).toEqual({ success: true });
		expect(mapAuthResult({ success: false, error: "user_cancel" })).toEqual(fail("cancelled"));
		expect(mapAuthResult({ success: false, error: "system_cancel" })).toEqual(fail("cancelled"));
		expect(mapAuthResult({ success: false, error: "not_enrolled" })).toEqual(fail("unavailable"));
		expect(mapAuthResult({ success: false, error: "passcode_not_set" })).toEqual(fail("unavailable"));
		expect(mapAuthResult({ success: false, error: "authentication_failed" })).toEqual(fail("failed"));
		expect(mapAuthResult({ success: false })).toEqual(fail("failed"));
	});
});

function portOf(availability: Availability, outcome: AuthOutcome) {
	const prompts: string[] = [];
	const port: BiometricPort = {
		availability: async () => availability,
		authenticate: async (m) => {
			prompts.push(m);
			return outcome;
		},
	};
	return { port, prompts };
}

describe("requestEnable", () => {
	it("sem leitor: explica e nem abre o aviso", async () => {
		const { port, prompts } = portOf("no-hardware", { success: true });
		expect(await requestEnable(port)).toEqual({ ok: false, message: MESSAGES.noHardware });
		expect(prompts).toEqual([]);
	});
	it("sem digital cadastrada: explica e nem abre o aviso", async () => {
		const { port, prompts } = portOf("not-enrolled", { success: true });
		expect(await requestEnable(port)).toEqual({ ok: false, message: MESSAGES.notEnrolled });
		expect(prompts).toEqual([]);
	});
	it("liga só depois do aviso ser aprovado", async () => {
		const { port, prompts } = portOf("ready", { success: true });
		expect(await requestEnable(port)).toEqual({ ok: true });
		expect(prompts).toEqual([MESSAGES.enablePrompt]);
	});
	it("desistir não gera mensagem; falha gera", async () => {
		expect(await requestEnable(portOf("ready", fail("cancelled")).port)).toEqual({
			ok: false,
			message: null,
		});
		expect(await requestEnable(portOf("ready", fail("failed")).port)).toEqual({
			ok: false,
			message: MESSAGES.enableFailed,
		});
	});
});

describe("lockReducer", () => {
	it("abertura a frio com bloqueio ligado começa travado", () => {
		const s = run([{ type: "loaded", enabled: true }]);
		expect(s.status).toBe("locked");
		expect(isCovered(s)).toBe(true);
	});
	it("abertura a frio sem bloqueio: livre e nunca cobre", () => {
		const s = run([
			{ type: "loaded", enabled: false },
			{ type: "background", now: 0 },
		]);
		expect(s.status).toBe("unlocked");
		expect(isCovered(s)).toBe(false);
	});
	it("'loaded' só vale uma vez", () => {
		const s = run([
			{ type: "loaded", enabled: true },
			{ type: "loaded", enabled: false },
		]);
		expect(s.status).toBe("locked");
	});
	it("destravar com sucesso", () => {
		const s = run([
			{ type: "loaded", enabled: true },
			{ type: "auth-start" },
			{ type: "auth-result", outcome: { success: true } },
		]);
		expect(s).toMatchObject({ status: "unlocked", enabled: true, authenticating: false });
		expect(isCovered(s)).toBe(false);
	});
	it("cancelar ou errar mantém travado, com mensagem, e permite tentar de novo", () => {
		const base = run([{ type: "loaded", enabled: true }, { type: "auth-start" }]);
		const cancelled = lockReducer(base, { type: "auth-result", outcome: fail("cancelled") });
		expect(cancelled).toMatchObject({
			status: "locked",
			authenticating: false,
			message: MESSAGES.unlockCancelled,
		});
		const failed = lockReducer(base, { type: "auth-result", outcome: fail("failed") });
		expect(failed.message).toBe(MESSAGES.unlockFailed);
		expect(lockReducer(failed, { type: "auth-start" }).authenticating).toBe(true);
	});
	it("não abre dois avisos ao mesmo tempo", () => {
		const s = run([{ type: "loaded", enabled: true }, { type: "auth-start" }]);
		expect(lockReducer(s, { type: "auth-start" })).toBe(s);
	});
	it("sem como autenticar: destrava e desliga o bloqueio", () => {
		const s = run([
			{ type: "loaded", enabled: true },
			{ type: "auth-start" },
			{ type: "auth-result", outcome: fail("unavailable") },
		]);
		expect(s).toMatchObject({ status: "unlocked", enabled: false });
	});
	it("volta antes da tolerância: não trava, mas cobre enquanto estava fora", () => {
		const away = lockReducer(openAndEnabled(), { type: "background", now: 1000 });
		expect(isCovered(away)).toBe(true);
		const back = lockReducer(away, { type: "foreground", now: 1000 + GRACE_MS - 1 });
		expect(back.status).toBe("unlocked");
		expect(isCovered(back)).toBe(false);
	});
	it("volta depois da tolerância: trava", () => {
		const s = run(
			[
				{ type: "background", now: 1000 },
				{ type: "foreground", now: 1000 + GRACE_MS },
			],
			openAndEnabled(),
		);
		expect(s).toMatchObject({ status: "locked", backgroundedAt: null });
		expect(isCovered(s)).toBe(true);
	});
	it("o aviso do sistema não conta como sair; segundo 'background' não adia o relógio", () => {
		const locked = run([{ type: "loaded", enabled: true }, { type: "auth-start" }]);
		expect(lockReducer(locked, { type: "background", now: 5 })).toBe(locked);
		const away = lockReducer(openAndEnabled(), { type: "background", now: 1000 });
		expect(lockReducer(away, { type: "background", now: 2000 }).backgroundedAt).toBe(1000);
	});
	it("travado, ir e voltar do segundo plano não muda nada", () => {
		const locked = run([{ type: "loaded", enabled: true }]);
		expect(lockReducer(locked, { type: "background", now: 1 })).toBe(locked);
		expect(lockReducer(locked, { type: "foreground", now: 99999999 })).toBe(locked);
	});
	it("desligar nas configurações limpa tudo; ligar não trava na hora", () => {
		const on = openAndEnabled();
		expect(on).toMatchObject({ enabled: true, status: "unlocked" });
		const off = lockReducer(on, { type: "enabled-changed", enabled: false });
		expect(off.enabled).toBe(false);
		expect(isCovered(off)).toBe(false);
	});
	it("ligar/desligar antes de carregar é ignorado", () => {
		expect(lockReducer(initialLockState, { type: "enabled-changed", enabled: true })).toBe(initialLockState);
	});
});
