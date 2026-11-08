import type { ImportNeedsMapping, ImportPreviewReady } from "@orbita/shared";
import { describe, expect, it } from "vitest";
import {
	buildMapping,
	fileProblem,
	importedMessage,
	initialChoice,
	periodLabel,
	previewHeadline,
	previewNotes,
	targetFields,
} from "./import-model.ts";

const need: ImportNeedsMapping = {
	status: "needs_mapping",
	format: "csv",
	delimiter: ";",
	headerRow: 0,
	columns: ["dia", "oque", "quanto", "outro"],
	sample: [],
	suggested: { date: 0, description: [1] },
	reason: "x",
};

const preview = (extra: Partial<ImportPreviewReady> = {}): ImportPreviewReady => ({
	status: "ok",
	format: "ofx",
	total: 3,
	toCreate: 3,
	duplicates: 0,
	possibleDuplicates: 0,
	creditsSkipped: 0,
	period: { from: "2026-11-02", to: "2026-11-05" },
	inCents: 0,
	outCents: 0,
	items: [],
	unrecognized: [],
	unrecognizedTotal: 0,
	warnings: [],
	alreadyImported: null,
	...extra,
});

describe("fileProblem", () => {
	it("aceita CSV, OFX e PDF até 5 MB", () => {
		expect(fileProblem({ name: "a.CSV", size: 10 })).toBeNull();
		expect(fileProblem({ name: "a.ofx" })).toBeNull();
		expect(fileProblem({ name: "fatura.pdf", size: 5 * 1024 * 1024 })).toBeNull();
	});
	it("recusa o resto", () => {
		expect(fileProblem({ name: "a.exe", size: 1 })).toMatch(/CSV, OFX ou PDF/);
		expect(fileProblem({ name: "semextensao" })).toMatch(/CSV, OFX ou PDF/);
		expect(fileProblem({ name: "a.pdf", size: 5 * 1024 * 1024 + 1 })).toBe("O arquivo passa de 5 MB.");
		expect(fileProblem({ name: "a.csv", size: 0 })).toBe("O arquivo está vazio.");
	});
});

describe("textos", () => {
	it("período", () => {
		expect(periodLabel({ from: "2026-11-02", to: "2026-11-05" })).toBe("2 de nov a 5 de nov");
		expect(periodLabel({ from: "2026-11-02", to: "2026-11-02" })).toBe("2 de nov");
		expect(periodLabel(null)).toBe("—");
	});
	it("manchete e avisos", () => {
		expect(previewHeadline(preview({ toCreate: 1 }))).toBe("1 lançamento novo para revisar.");
		expect(previewHeadline(preview())).toBe("3 lançamentos novos para revisar.");
		expect(previewHeadline(preview({ toCreate: 0 }))).toBe("Nada novo neste arquivo.");
		expect(
			previewNotes(
				preview({
					duplicates: 1,
					possibleDuplicates: 2,
					creditsSkipped: 1,
					unrecognizedTotal: 4,
					warnings: ["aviso"],
				}),
			),
		).toEqual([
			"1 já estava no Órbita e fica de fora.",
			"2 parecem repetir um lançamento do mesmo dia e valor.",
			"1 entrada do cartão não é importada.",
			"4 linhas não entendidas.",
			"aviso",
		]);
	});
	it("resultado", () => {
		expect(importedMessage({ created: 2, duplicates: 0, unrecognized: 0 })).toBe(
			"2 lançamentos foram para Para revisar.",
		);
		expect(importedMessage({ created: 1, duplicates: 0, unrecognized: 0 })).toBe(
			"1 lançamento foi para Para revisar.",
		);
		expect(importedMessage({ created: 0, duplicates: 3, unrecognized: 0 })).toBe(
			"Nenhum lançamento novo entrou.",
		);
	});
});

describe("mapeamento de colunas", () => {
	it("parte da sugestão do servidor", () => {
		expect(initialChoice(need)).toMatchObject({ date: 0, description: 1, mode: "amount", amount: null });
		expect(
			initialChoice({ ...need, suggested: { date: 0, description: [1], debit: 2, credit: 3 } }).mode,
		).toBe("split");
	});
	it("só monta com tudo escolhido e sem coluna repetida", () => {
		const base = initialChoice(need);
		expect(buildMapping(need, base)).toBeNull();
		expect(buildMapping(need, { ...base, amount: 2 })).toEqual({
			delimiter: ";",
			headerRow: 0,
			date: 0,
			description: [1],
			amount: 2,
		});
		expect(buildMapping(need, { ...base, amount: 1 })).toBeNull();
		expect(buildMapping(need, { ...base, mode: "split", debit: 2 })).toBeNull();
		expect(buildMapping(need, { ...base, mode: "split", debit: 2, credit: 3 })).toMatchObject({
			debit: 2,
			credit: 3,
		});
		expect(buildMapping(need, { ...base, mode: "split", debit: 2, credit: 2 })).toBeNull();
	});
	it("mantém o identificador sugerido", () => {
		const withId = { ...need, suggested: { ...need.suggested, externalId: 3 } };
		expect(buildMapping(withId, { ...initialChoice(withId), amount: 2 })?.externalId).toBe(3);
	});
});

describe("destino", () => {
	it("conta ou cartão", () => {
		expect(targetFields({ kind: "account", id: "a1" })).toEqual({ accountId: "a1" });
		expect(targetFields({ kind: "card", id: "c1" })).toEqual({ cardId: "c1" });
	});
});
