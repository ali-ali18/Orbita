import { describe, expect, it } from "vitest";
import {
	appliedMessage,
	applyAllLabel,
	bankCategoryLabel,
	buildPatch,
	canApplyToAll,
	type DetailTransaction,
	deleteChoices,
	editableFields,
	installmentText,
	invoiceText,
	sourceTitle,
	statusText,
} from "./detail-model.ts";

const base: DetailTransaction = {
	id: "t1",
	kind: "expense",
	amountCents: 4690,
	date: "2026-11-07",
	description: "iFood",
	categoryId: "c1",
	accountId: null,
	cardId: "k1",
	invoiceMonth: "2026-12",
	installmentGroupId: null,
	installmentNumber: null,
	installmentCount: null,
	status: "confirmed",
	source: "manual",
	note: null,
};

describe("editableFields", () => {
	it("lançamento manual à vista edita tudo", () => {
		expect(editableFields(base)).toMatchObject({ category: true, amountAndDate: true, lockNote: null });
	});

	it("vindo do Pluggy trava valor e data, mas deixa categoria, descrição e nota", () => {
		const e = editableFields({ ...base, source: "pluggy" });
		expect(e.amountAndDate).toBe(false);
		expect(e.category).toBe(true);
		expect(e.lockNote).toMatch(/vêm do banco/);
	});

	it("parcela trava valor, data e cartão e explica o caminho", () => {
		const e = editableFields({ ...base, installmentGroupId: "g1" });
		expect(e.amountAndDate).toBe(false);
		expect(e.lockNote).toMatch(/apague e lance de novo/);
	});

	it("Pluggy parcelado fala do banco (é o que o usuário não controla)", () => {
		expect(editableFields({ ...base, source: "pluggy", installmentGroupId: "g1" }).lockNote).toMatch(/banco/);
	});

	it("transferência e pagamento de fatura não têm categoria", () => {
		expect(editableFields({ ...base, kind: "transfer" }).category).toBe(false);
		expect(editableFields({ ...base, kind: "card_payment" }).category).toBe(false);
		expect(editableFields({ ...base, kind: "income" }).category).toBe(true);
		expect(editableFields({ ...base, kind: "refund" }).category).toBe(true);
	});
});

describe("buildPatch", () => {
	it("sem mudança não chama o servidor", () => {
		expect(buildPatch(base, { description: " iFood ", note: "", categoryId: "c1" })).toEqual({
			ok: true,
			body: null,
		});
	});

	it("manda só o que mudou", () => {
		expect(buildPatch(base, { categoryId: "c2" })).toEqual({ ok: true, body: { categoryId: "c2" } });
		expect(buildPatch(base, { description: "  Almoço  " })).toEqual({
			ok: true,
			body: { description: "Almoço" },
		});
	});

	it("categoria vazia vira null (limpa)", () => {
		expect(buildPatch(base, { categoryId: null })).toEqual({ ok: true, body: { categoryId: null } });
	});

	it("nota: texto aparado; vazio limpa; igual não manda", () => {
		expect(buildPatch(base, { note: "  combinado  " })).toEqual({ ok: true, body: { note: "combinado" } });
		expect(buildPatch({ ...base, note: "velha" }, { note: "   " })).toEqual({
			ok: true,
			body: { note: null },
		});
		expect(buildPatch({ ...base, note: "igual" }, { note: "igual" })).toEqual({ ok: true, body: null });
	});

	it("descrição vazia é recusada em pt-BR", () => {
		expect(buildPatch(base, { description: "   " })).toEqual({
			ok: false,
			message: "Informe a descrição do lançamento.",
		});
	});

	it("nota longa demais é recusada", () => {
		const r = buildPatch(base, { note: "a".repeat(1001) });
		expect(r.ok).toBe(false);
	});

	it("tipo sem categoria recusa trocar categoria", () => {
		expect(buildPatch({ ...base, kind: "transfer" }, { categoryId: "c2" }).ok).toBe(false);
	});

	it("nunca carrega status, mês de orçamento, valor ou data", () => {
		const r = buildPatch(base, { description: "x", note: "y", categoryId: "c2" });
		expect(r.ok && r.body && Object.keys(r.body).sort()).toEqual(["categoryId", "description", "note"]);
	});
});

describe("deleteChoices", () => {
	it("à vista só apaga", () => {
		expect(deleteChoices(base)).toEqual([{ scope: "item", label: "Apagar lançamento" }]);
	});

	it("parcela oferece só esta ou o parcelamento todo", () => {
		const choices = deleteChoices({ installmentGroupId: "g1", installmentCount: 10 });
		expect(choices.map((c) => c.scope)).toEqual(["item", "group"]);
		expect(choices[1]?.label).toBe("Todo o parcelamento (10 parcelas)");
	});
});

describe("rótulos", () => {
	it("parcela e à vista", () => {
		expect(installmentText({ installmentNumber: 3, installmentCount: 10 })).toBe("3/10");
		expect(installmentText({ installmentNumber: null, installmentCount: null })).toBe("À vista");
	});

	it("fatura: mês por extenso, com ano se for de outro ano", () => {
		expect(invoiceText("2026-12", "2026-11-07")).toBe("Dezembro");
		expect(invoiceText("2027-01", "2026-11-07")).toBe("Janeiro de 2027");
		expect(invoiceText(null, "2026-11-07")).toBeNull();
	});

	it("origem e situação", () => {
		expect(sourceTitle("pluggy")).toBe("Importado do Meu Pluggy");
		expect(sourceTitle("manual")).toBe("Lançado por você");
		expect(statusText("pending").title).toBe("Para revisar");
		expect(statusText("confirmed").title).toBe("Confirmado");
	});
});

describe("aplicar a todos da loja", () => {
	it("só despesa e estorno com categoria escolhida", () => {
		expect(canApplyToAll(base)).toBe(true);
		expect(canApplyToAll({ ...base, kind: "refund" })).toBe(true);
		expect(canApplyToAll({ ...base, categoryId: null })).toBe(false);
		expect(canApplyToAll({ ...base, kind: "income" })).toBe(false);
		expect(canApplyToAll({ ...base, kind: "transfer" })).toBe(false);
		expect(canApplyToAll({ ...base, kind: "card_payment" })).toBe(false);
	});

	it("o nome da loja é o do banco, senão a descrição", () => {
		expect(applyAllLabel({ merchantName: "Uber", description: "UBER *TRIP" })).toBe(
			"Aplicar a todos de Uber",
		);
		expect(applyAllLabel({ merchantName: "  ", description: "iFood" })).toBe("Aplicar a todos de iFood");
		expect(applyAllLabel({ description: "iFood" })).toBe("Aplicar a todos de iFood");
	});

	it("mensagem do resultado concorda em número", () => {
		expect(appliedMessage(0)).toBe("Nenhum outro lançamento para atualizar.");
		expect(appliedMessage(1)).toBe("1 lançamento atualizado");
		expect(appliedMessage(12)).toBe("12 lançamentos atualizados");
	});

	it("categoria no banco só aparece quando o banco mandou", () => {
		expect(bankCategoryLabel({ sourceCategory: "Shopping › Eletrônicos" })).toBe(
			"Categoria no banco: Shopping › Eletrônicos",
		);
		expect(bankCategoryLabel({ sourceCategory: null })).toBeNull();
		expect(bankCategoryLabel({ sourceCategory: "  " })).toBeNull();
		expect(bankCategoryLabel({})).toBeNull();
	});
});
