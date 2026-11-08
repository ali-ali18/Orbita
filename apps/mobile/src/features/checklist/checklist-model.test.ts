import { describe, expect, it } from "vitest";
import {
	type ChecklistFacts,
	deriveChecklist,
	factsLoaded,
	hasSetup,
	isDismissed,
	isFirstUse,
	progressText,
	shouldShowChecklist,
} from "./checklist-model.ts";

const none: ChecklistFacts = {
	connectionCount: 0,
	hasSetup: false,
	hasBudget: false,
	transactionCount: 0,
	biometricOn: false,
};

describe("deriveChecklist", () => {
	it("só o servidor está feito para quem acabou de entrar", () => {
		const c = deriveChecklist(none);
		expect(c.doneCount).toBe(1);
		expect(c.total).toBe(6);
		expect(c.complete).toBe(false);
		expect(c.items.filter((i) => i.done).map((i) => i.id)).toEqual(["server"]);
	});
	it("cada item acende com o dado correspondente", () => {
		const c = deriveChecklist({
			connectionCount: 1,
			hasSetup: true,
			hasBudget: true,
			transactionCount: 0,
			biometricOn: false,
		});
		expect(c.items.filter((i) => i.done).map((i) => i.id)).toEqual(["server", "bank", "setup", "budget"]);
		expect(progressText(c)).toBe("4 de 6 concluídos");
	});
	it("completa com tudo feito", () => {
		const c = deriveChecklist({
			connectionCount: 2,
			hasSetup: true,
			hasBudget: true,
			transactionCount: 10,
			biometricOn: true,
		});
		expect(c.complete).toBe(true);
		expect(c.doneCount).toBe(6);
	});
	it("o que ainda não carregou não conta como feito", () => {
		const c = deriveChecklist({
			connectionCount: undefined,
			hasSetup: undefined,
			hasBudget: undefined,
			transactionCount: undefined,
			biometricOn: undefined,
		});
		expect(c.doneCount).toBe(1);
	});
	it("cada item aponta para a sua tela", () => {
		expect(deriveChecklist(none).items.map((i) => i.href)).toEqual([
			"/configuracoes/servidor",
			"/configuracoes/bancos",
			"/chat?intent=setup",
			"/configuracoes/orcamento",
			"/novo",
			"/configuracoes",
		]);
	});
});

describe("progressText", () => {
	it("singular e plural", () => {
		expect(progressText({ doneCount: 1, total: 6 })).toBe("1 de 6 concluído");
		expect(progressText({ doneCount: 2, total: 6 })).toBe("2 de 6 concluídos");
	});
});

describe("shouldShowChecklist", () => {
	it("mostra com passo faltando e sem dispensar", () => {
		expect(shouldShowChecklist(none, false).show).toBe(true);
	});
	it("some quando dispensada", () => {
		expect(shouldShowChecklist(none, true).show).toBe(false);
	});
	it("some quando completa", () => {
		const all = {
			connectionCount: 1,
			hasSetup: true,
			hasBudget: true,
			transactionCount: 1,
			biometricOn: true,
		};
		expect(shouldShowChecklist(all, false).show).toBe(false);
	});
	it("espera tudo carregar e o cofre responder", () => {
		expect(shouldShowChecklist({ ...none, hasBudget: undefined }, false).show).toBe(false);
		expect(shouldShowChecklist(none, null).show).toBe(false);
	});
});

describe("factsLoaded, isFirstUse e isDismissed", () => {
	it("factsLoaded exige todos os fatos", () => {
		expect(factsLoaded({ ...none, hasSetup: undefined })).toBe(false);
		expect(factsLoaded(none)).toBe(true);
		expect(factsLoaded({ ...none, biometricOn: undefined })).toBe(false);
	});
	it("primeiro uso é zero lançamentos carregado", () => {
		expect(isFirstUse(0)).toBe(true);
		expect(isFirstUse(3)).toBe(false);
		expect(isFirstUse(undefined)).toBe(false);
	});
	it("dispensada só com o valor gravado", () => {
		expect(isDismissed("1")).toBe(true);
		expect(isDismissed(null)).toBe(false);
		expect(isDismissed("0")).toBe(false);
	});
});

describe("hasSetup", () => {
	const sub = (over: Partial<{ kind: string; archivedAt: string | null }> = {}) => ({
		kind: "expense",
		archivedAt: null,
		...over,
	});
	it("renda ou assinatura ativa vale como configurado", () => {
		expect(hasSetup(1, [])).toBe(true);
		expect(hasSetup(0, [sub()])).toBe(true);
		expect(hasSetup(undefined, [sub()])).toBe(true);
		expect(hasSetup(1, undefined)).toBe(true);
	});
	it("receita recorrente ou assinatura arquivada não contam", () => {
		expect(hasSetup(0, [sub({ kind: "income" }), sub({ archivedAt: "2026-11-01T00:00:00.000Z" })])).toBe(
			false,
		);
	});
	it("espera as duas consultas quando nada diz que sim", () => {
		expect(hasSetup(undefined, [])).toBeUndefined();
		expect(hasSetup(0, undefined)).toBeUndefined();
		expect(hasSetup(0, [])).toBe(false);
	});
});
