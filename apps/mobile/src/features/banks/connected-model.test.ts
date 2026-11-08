import type { PluggyConnectionDto } from "@orbita/shared";
import { describe, expect, it } from "vitest";
import {
	connectedPrimary,
	connectedRows,
	connectedTitle,
	isReadyToCelebrate,
	newConnection,
} from "./connected-model.ts";

const conn = (id: string, over: Partial<PluggyConnectionDto> = {}): PluggyConnectionDto => ({
	id,
	label: "Santander",
	createdAt: "2026-11-08T10:00:00.000Z",
	lastSyncAt: null,
	lastStatus: null,
	lastError: null,
	summary: { accounts: 0, cards: 0 },
	...over,
});

describe("newConnection", () => {
	it("acha a que não existia antes", () => {
		expect(newConnection(["a"], [conn("a"), conn("b")])?.id).toBe("b");
	});
	it("nada novo: null", () => {
		expect(newConnection(["a"], [conn("a")])).toBeNull();
		expect(newConnection([], [])).toBeNull();
	});
});

describe("isReadyToCelebrate", () => {
	it("só com a sincronização parada e dado trazido", () => {
		expect(isReadyToCelebrate({ lastStatus: "ok" }, "idle")).toBe(true);
		expect(isReadyToCelebrate({ lastStatus: "partial" }, "idle")).toBe(true);
		expect(isReadyToCelebrate({ lastStatus: "ok" }, "running")).toBe(false);
		expect(isReadyToCelebrate({ lastStatus: "ok" }, "queued")).toBe(false);
		expect(isReadyToCelebrate({ lastStatus: "error" }, "idle")).toBe(false);
		expect(isReadyToCelebrate({ lastStatus: null }, "idle")).toBe(false);
	});
});

describe("connectedTitle", () => {
	it("usa o nome da conexão", () => {
		expect(connectedTitle({ label: "Santander" })).toBe("Santander conectado");
		expect(connectedTitle({ label: null })).toBe("Conexão sem nome conectado");
	});
});

describe("connectedRows", () => {
	it("contas e cartões só se vieram", () => {
		expect(connectedRows({ summary: { accounts: 0, cards: 1 }, imported: 214, pending: 3 })).toEqual([
			{ label: "Cartão", value: 1 },
			{ label: "Lançamentos importados", value: 214 },
			{ label: "Para você revisar", value: 3 },
		]);
		expect(
			connectedRows({ summary: { accounts: 2, cards: 2 }, imported: 0, pending: 0 }).map((r) => r.label),
		).toEqual(["Contas", "Cartões", "Lançamentos importados", "Para você revisar"]);
	});
	it("número que ainda não chegou fica de fora", () => {
		expect(connectedRows({ summary: { accounts: 1, cards: 0 }, imported: null, pending: null })).toEqual([
			{ label: "Conta", value: 1 },
		]);
	});
});

describe("connectedPrimary", () => {
	it("revisar quando há pendentes", () => {
		expect(connectedPrimary(3)).toEqual({ label: "Revisar os 3", target: "review" });
		expect(connectedPrimary(1)).toEqual({ label: "Revisar 1", target: "review" });
	});
	it("sem pendentes, volta ao Início", () => {
		expect(connectedPrimary(0).target).toBe("home");
		expect(connectedPrimary(null).target).toBe("home");
	});
});
