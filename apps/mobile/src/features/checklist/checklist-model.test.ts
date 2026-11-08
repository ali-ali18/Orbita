import { describe, expect, it } from "vitest";
import {
	type ChecklistFacts,
	deriveChecklist,
	factsLoaded,
	isDismissed,
	isFirstUse,
	progressText,
	shouldShowChecklist,
} from "./checklist-model.ts";

const none: ChecklistFacts = {
	connectionCount: 0,
	hasBudget: false,
	transactionCount: 0,
	biometricOn: false,
};

describe("deriveChecklist", () => {
	it("só o servidor está feito para quem acabou de entrar", () => {
		const c = deriveChecklist(none);
		expect(c.doneCount).toBe(1);
		expect(c.total).toBe(5);
		expect(c.complete).toBe(false);
		expect(c.items.filter((i) => i.done).map((i) => i.id)).toEqual(["server"]);
	});
	it("cada item acende com o dado correspondente", () => {
		const c = deriveChecklist({
			connectionCount: 1,
			hasBudget: true,
			transactionCount: 0,
			biometricOn: false,
		});
		expect(c.items.filter((i) => i.done).map((i) => i.id)).toEqual(["server", "bank", "budget"]);
		expect(progressText(c)).toBe("3 de 5 concluídos");
	});
	it("completa com tudo feito", () => {
		const c = deriveChecklist({
			connectionCount: 2,
			hasBudget: true,
			transactionCount: 10,
			biometricOn: true,
		});
		expect(c.complete).toBe(true);
		expect(c.doneCount).toBe(5);
	});
	it("o que ainda não carregou não conta como feito", () => {
		const c = deriveChecklist({
			connectionCount: undefined,
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
			"/configuracoes/orcamento",
			"/novo",
			"/configuracoes",
		]);
	});
});

describe("progressText", () => {
	it("singular e plural", () => {
		expect(progressText({ doneCount: 1, total: 5 })).toBe("1 de 5 concluído");
		expect(progressText({ doneCount: 2, total: 5 })).toBe("2 de 5 concluídos");
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
		const all = { connectionCount: 1, hasBudget: true, transactionCount: 1, biometricOn: true };
		expect(shouldShowChecklist(all, false).show).toBe(false);
	});
	it("espera tudo carregar e o cofre responder", () => {
		expect(shouldShowChecklist({ ...none, hasBudget: undefined }, false).show).toBe(false);
		expect(shouldShowChecklist(none, null).show).toBe(false);
	});
});

describe("factsLoaded, isFirstUse e isDismissed", () => {
	it("factsLoaded exige os quatro", () => {
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
