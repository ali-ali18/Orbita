import { agentSettingsSchemas, BUILTIN_AGENTS } from "@orbita/shared";
import { describe, expect, it } from "vitest";
import {
	ACTIVITY_KIND_LABEL,
	AUTONOMY_OPTIONS,
	autonomyLabel,
	autonomyOf,
	CONFIRM_REVERSIBLE,
	NEVER_DOES,
	opportunityValue,
	REVERSIBLE_DOES,
	SAVINGS_SHOWN,
	savingsHeadline,
	undoneLabel,
	visibleOpportunities,
} from "./economy-model.ts";

describe("autonomia", () => {
	it("o padrão é só avisar e qualquer valor estranho cai nele", () => {
		expect(autonomyOf({})).toBe("notify");
		expect(autonomyOf({ autonomy: "tudo" })).toBe("notify");
		expect(autonomyOf({ autonomy: "reversible" })).toBe("reversible");
		expect(BUILTIN_AGENTS.economia.defaultSettings.autonomy).toBe("notify");
	});

	it("as duas opções batem com os níveis que o servidor aceita", () => {
		const accepted = agentSettingsSchemas.economia.shape.autonomy.options;
		expect(AUTONOMY_OPTIONS.map((o) => o.id)).toEqual([...accepted]);
		expect(autonomyLabel("notify")).toBe("Só avisar");
		expect(autonomyLabel("reversible")).toBe("Agir no que é reversível");
	});

	it("o aviso de permissão lista o que faz e o que nunca faz", () => {
		expect(REVERSIBLE_DOES).toHaveLength(5);
		expect(CONFIRM_REVERSIBLE.message).toContain("Desfazer");
		expect(CONFIRM_REVERSIBLE.message).toContain(NEVER_DOES);
		expect(NEVER_DOES).toMatch(/apago.*movo dinheiro.*pago.*editou/);
	});
});

describe("onde cortar", () => {
	it("mostra a economia em reais, ou 'Atenção' quando é um risco sem economia", () => {
		expect(opportunityValue({ monthlySavingsCents: 1790 }, false)).toEqual({
			value: "R$ 17,90",
			caption: "por mês",
		});
		expect(opportunityValue({ monthlySavingsCents: 1790 }, true).value).toBe("••••");
		expect(opportunityValue({ monthlySavingsCents: 0 }, false)).toEqual({
			value: "Atenção",
			caption: "sem economia",
		});
	});

	it("o título só aparece quando há o que cortar e respeita o olho fechado", () => {
		expect(savingsHeadline(2790, false)).toBe("Dá para cortar até R$ 27,90 por mês");
		expect(savingsHeadline(2790, true)).toBe("Dá para cortar até •••• por mês");
		expect(savingsHeadline(0, false)).toBeNull();
	});

	it("mostra os primeiros e deixa o resto atrás de 'Ver todos'", () => {
		const list = Array.from({ length: SAVINGS_SHOWN + 3 }, (_, i) => i);
		expect(visibleOpportunities(list, false)).toHaveLength(SAVINGS_SHOWN);
		expect(visibleOpportunities(list, true)).toHaveLength(list.length);
	});
});

describe("registro", () => {
	it("cada tipo de ação tem um rótulo curto", () => {
		expect(Object.values(ACTIVITY_KIND_LABEL).every((l) => l.length > 0 && l.length <= 14)).toBe(true);
		expect(Object.keys(ACTIVITY_KIND_LABEL)).toHaveLength(5);
	});

	it("desfeita mostra a nota (ou 'Desfeito'); feita deixa o botão", () => {
		expect(undoneLabel({ status: "done", undoNote: null })).toBeNull();
		expect(undoneLabel({ status: "applying", undoNote: null })).toBe("Em andamento");
		expect(undoneLabel({ status: "undone", undoNote: null })).toBe("Desfeito");
		expect(undoneLabel({ status: "undone", undoNote: "Você já tinha mudado." })).toBe(
			"Você já tinha mudado.",
		);
	});
});
