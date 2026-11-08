import { describe, expect, it } from "vitest";
import {
	addPart,
	amountToText,
	buildSplitRequest,
	canAddPart,
	canRemovePart,
	canSplit,
	differenceLabel,
	evaluateSplit,
	initialSplitDraft,
	parseAmountText,
	removePart,
	updatePart,
} from "./split-model.ts";

const total = 4690;

describe("canSplit", () => {
	const base = { kind: "expense" as const, installmentGroupId: null, amountCents: 4690 };
	it("despesa e receita avulsas dividem", () => {
		expect(canSplit(base)).toBe(true);
		expect(canSplit({ ...base, kind: "income" })).toBe(true);
	});
	it("parcela, transferência, pagamento de fatura e estorno não", () => {
		expect(canSplit({ ...base, installmentGroupId: "g" })).toBe(false);
		for (const kind of ["transfer", "card_payment", "refund"] as const) {
			expect(canSplit({ ...base, kind })).toBe(false);
		}
	});
	it("precisa de pelo menos 2 centavos", () => {
		expect(canSplit({ ...base, amountCents: 1 })).toBe(false);
		expect(canSplit({ ...base, amountCents: 2 })).toBe(true);
	});
});

describe("valores do campo", () => {
	it("converte pt-BR para centavos e devolve null para o que não é dinheiro", () => {
		expect(parseAmountText("30")).toBe(3000);
		expect(parseAmountText("30,5")).toBe(3050);
		expect(parseAmountText("1.234,56")).toBe(123456);
		expect(parseAmountText("")).toBeNull();
		expect(parseAmountText("  ")).toBeNull();
		expect(parseAmountText("46.90")).toBeNull();
		expect(parseAmountText("abc")).toBeNull();
	});
	it("amountToText é o inverso de parseAmountText", () => {
		for (const cents of [1, 99, 100, 4690, 123456, 100000000]) {
			expect(parseAmountText(amountToText(cents))).toBe(cents);
		}
		expect(amountToText(4690)).toBe("46,90");
	});
});

describe("rascunho", () => {
	it("começa em duas partes iguais que já fecham, a primeira com a categoria atual", () => {
		const draft = initialSplitDraft(total, "c-del");
		expect(draft.parts).toEqual([
			{ amountText: "23,45", categoryId: "c-del" },
			{ amountText: "23,45", categoryId: null },
		]);
		expect(evaluateSplit(total, draft).ok).toBe(true);
	});

	it("o resto dos centavos fica na primeira parte", () => {
		const draft = initialSplitDraft(4691, null);
		expect(draft.parts.map((p) => p.amountText)).toEqual(["23,46", "23,45"]);
		expect(evaluateSplit(4691, draft).ok).toBe(true);
	});

	it("adicionar e remover refazem em partes iguais e mantêm as categorias", () => {
		let draft = initialSplitDraft(10000, "a");
		draft = updatePart(draft, 1, { categoryId: "b" });
		draft = addPart(10000, draft);
		expect(draft.parts.map((p) => [p.amountText, p.categoryId])).toEqual([
			["33,34", "a"],
			["33,33", "b"],
			["33,33", null],
		]);
		expect(evaluateSplit(10000, draft).ok).toBe(true);
		draft = removePart(10000, draft, 1);
		expect(draft.parts.map((p) => [p.amountText, p.categoryId])).toEqual([
			["50,00", "a"],
			["50,00", null],
		]);
	});

	it("respeita os limites de 2 e 20 partes e de 1 centavo por parte", () => {
		const two = initialSplitDraft(total, null);
		expect(canRemovePart(two)).toBe(false);
		expect(removePart(total, two, 0)).toBe(two);
		let draft = two;
		while (canAddPart(total, draft)) draft = addPart(total, draft);
		expect(draft.parts).toHaveLength(20);
		expect(addPart(total, draft)).toBe(draft);
		const tiny = initialSplitDraft(2, null);
		expect(canAddPart(2, tiny)).toBe(false);
	});
});

describe("evaluateSplit e differenceLabel (o número vem do engine)", () => {
	const draftOf = (...texts: string[]) => ({
		parts: texts.map((amountText) => ({ amountText, categoryId: null })),
	});

	it("fecha exatamente", () => {
		const e = evaluateSplit(total, draftOf("30,00", "16,90"));
		expect(e).toEqual({ ok: true, differenceCents: 0, message: null });
		expect(differenceLabel(e)).toBe("Fecha certinho");
	});
	it("diz quanto falta", () => {
		const e = evaluateSplit(total, draftOf("30,00", "10,00"));
		expect(e).toMatchObject({ ok: false, differenceCents: 690 });
		expect(differenceLabel(e)).toBe("Falta R$ 6,90");
	});
	it("diz quanto passou", () => {
		const e = evaluateSplit(total, draftOf("30,00", "20,00"));
		expect(e).toMatchObject({ ok: false, differenceCents: -310 });
		expect(differenceLabel(e)).toBe("Passou R$ 3,10");
	});
	it("campo vazio ou inválido não tem diferença", () => {
		const e = evaluateSplit(total, draftOf("30,00", ""));
		expect(e).toMatchObject({ ok: false, differenceCents: null, message: "Confira o valor de cada parte." });
		expect(differenceLabel(e)).toBe("Informe o valor de cada parte");
	});
	it("parte zerada não passa mesmo somando certo", () => {
		const e = evaluateSplit(total, draftOf("46,90", "0"));
		expect(e).toMatchObject({ ok: false, message: "Cada parte precisa ter valor maior que zero." });
		expect(differenceLabel(e)).toBe("Confira as partes");
	});
});

describe("buildSplitRequest", () => {
	it("monta o corpo em centavos inteiros, sem categoria quando não há", () => {
		const draft = {
			parts: [
				{ amountText: "30,00", categoryId: "c1" },
				{ amountText: "16,90", categoryId: null },
			],
		};
		expect(buildSplitRequest(total, draft)).toEqual({
			ok: true,
			body: { parts: [{ amountCents: 3000, categoryId: "c1" }, { amountCents: 1690 }] },
		});
	});
	it("não monta pedido que o engine recusa", () => {
		const draft = {
			parts: [
				{ amountText: "30,00", categoryId: null },
				{ amountText: "10,00", categoryId: null },
			],
		};
		expect(buildSplitRequest(total, draft)).toEqual({
			ok: false,
			message: "As partes precisam somar exatamente o valor do lançamento.",
		});
	});
});
