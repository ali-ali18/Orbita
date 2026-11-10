import { PLUGGY_FIRST_SYNC_DAYS, type PluggyConnectionDto } from "@orbita/shared";
import { describe, expect, it } from "vitest";
import {
	CONNECTED_SUBTITLE,
	connectedPrimary,
	connectedRows,
	connectedTitle,
	firstSyncSpanText,
	IMPORTED_ALL_BANKS_LABEL,
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
		const summary = { accounts: 1, cards: 0 };
		expect(isReadyToCelebrate({ lastStatus: "ok", summary }, "idle")).toBe(true);
		expect(isReadyToCelebrate({ lastStatus: "partial", summary }, "idle")).toBe(true);
		expect(isReadyToCelebrate({ lastStatus: "ok", summary }, "running")).toBe(false);
		expect(isReadyToCelebrate({ lastStatus: "ok", summary }, "queued")).toBe(false);
		expect(isReadyToCelebrate({ lastStatus: "error", summary }, "idle")).toBe(false);
		expect(isReadyToCelebrate({ lastStatus: null, summary }, "idle")).toBe(false);
	});
	it("conexão que o banco ainda não preencheu não é comemorada", () => {
		const summary = { accounts: 0, cards: 0 };
		expect(isReadyToCelebrate({ lastStatus: "ok", summary }, "idle")).toBe(false);
		expect(isReadyToCelebrate({ lastStatus: "partial", summary }, "idle")).toBe(false);
		expect(isReadyToCelebrate({ lastStatus: "ok", summary: { accounts: 0, cards: 1 } }, "idle")).toBe(true);
	});
});

describe("connectedTitle", () => {
	it("usa o nome da conexão", () => {
		expect(connectedTitle({ label: "Santander" })).toBe("Santander conectado");
		expect(connectedTitle({ label: null })).toBe("Banco novo conectado");
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

describe("subtítulo da tela Pronto", () => {
	it("diz o tempo que a primeira importação realmente busca (183 dias = 6 meses), nunca 90 dias", () => {
		expect(PLUGGY_FIRST_SYNC_DAYS).toBe(183);
		expect(firstSyncSpanText(PLUGGY_FIRST_SYNC_DAYS)).toBe("6 meses");
		expect(CONNECTED_SUBTITLE).toBe("Trouxe os últimos 6 meses. Já separei em categorias.");
		expect(CONNECTED_SUBTITLE).not.toContain("90");
	});
	it("acompanha a constante compartilhada", () => {
		expect(firstSyncSpanText(30)).toBe("1 mês");
		expect(firstSyncSpanText(122)).toBe("4 meses");
	});
});

describe("total de lançamentos", () => {
	it("com uma conexão só, o total é dela e o rótulo é 'importados'", () => {
		const rows = connectedRows({
			summary: { accounts: 1, cards: 0 },
			imported: 40,
			pending: 0,
			connections: 1,
		});
		expect(rows.find((r) => r.value === 40)?.label).toBe("Lançamentos importados");
	});
	it("com várias conexões, o total soma todas e o rótulo não engana", () => {
		const rows = connectedRows({
			summary: { accounts: 1, cards: 0 },
			imported: 900,
			pending: 0,
			connections: 3,
		});
		expect(rows.find((r) => r.value === 900)?.label).toBe(IMPORTED_ALL_BANKS_LABEL);
	});
});
