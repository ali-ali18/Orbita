import { invoiceFor } from "@orbita/core";
import { beforeEach, describe, expect, it } from "vitest";
import { contractSuites } from "./contract-harness.ts";
import type { Stores } from "./stores.ts";

describe.each(contractSuites())("CardStore (%s)", (_name, make) => {
	let stores: Stores;
	beforeEach(async () => {
		stores = await make();
	});

	it("cria com padrões e devolve o que o engine espera", async () => {
		const card = await stores.cards.create({ name: "Nubank", closingDay: 10, dueDay: 17 });
		expect(card).toMatchObject({
			closingRule: "closing-day-next",
			last4: null,
			limitCents: null,
			bankCode: null,
			archivedAt: null,
		});
		const config = await stores.cards.getConfig(card.id);
		expect(config).toEqual({ closingDay: 10, dueDay: 17, closingRule: "closing-day-next" });
		// Fecha dia 10, vence dia 17: compra dia 9 cai na fatura de novembro.
		expect(invoiceFor("2026-11-09", config ?? { closingDay: 1, dueDay: 1 }).month).toBe("2026-11");
		expect(await stores.cards.getConfig("nada")).toBeNull();
	});

	it("guarda a regra 'incluído' e o limite", async () => {
		const card = await stores.cards.create({
			name: "Itaú",
			closingDay: 31,
			dueDay: 5,
			closingRule: "closing-day-included",
			limitCents: 1_500_000,
			last4: "0042",
			bankCode: "60701190",
		});
		expect(await stores.cards.get(card.id)).toEqual(card);
		expect(card).toMatchObject({ closingRule: "closing-day-included", limitCents: 1_500_000, last4: "0042" });
		expect((await stores.cards.getConfig(card.id))?.closingRule).toBe("closing-day-included");
	});

	it("atualiza, arquiva e esconde da lista", async () => {
		const card = await stores.cards.create({ name: "Nubank", closingDay: 10, dueDay: 17 });
		const updated = await stores.cards.update(card.id, {
			dueDay: 20,
			limitCents: 500_00,
			closingRule: "closing-day-included",
		});
		expect(updated).toMatchObject({
			closingDay: 10,
			dueDay: 20,
			limitCents: 50_000,
			closingRule: "closing-day-included",
		});
		expect((await stores.cards.update(card.id, { limitCents: null })).limitCents).toBeNull();
		await stores.cards.archive(card.id);
		expect(await stores.cards.list()).toEqual([]);
		expect(await stores.cards.get(card.id)).not.toBeNull();
	});

	it.each([
		[{ closingDay: 0, dueDay: 10 }, "O dia de fechamento deve ser um dia de 1 a 31."],
		[{ closingDay: 10, dueDay: 32 }, "O dia de vencimento deve ser um dia de 1 a 31."],
		[{ closingDay: 1.5, dueDay: 10 }, "O dia de fechamento deve ser um dia de 1 a 31."],
		[{ closingDay: 10, dueDay: 10, last4: "12a4" }, "Informe os 4 últimos dígitos do cartão."],
		[{ closingDay: 10, dueDay: 10, last4: "123" }, "Informe os 4 últimos dígitos do cartão."],
		[
			{ closingDay: 10, dueDay: 10, limitCents: -1 },
			"O limite do cartão deve ser um inteiro de centavos, zero ou mais.",
		],
		[
			{ closingDay: 10, dueDay: 10, limitCents: 10.5 },
			"O limite do cartão deve ser um inteiro de centavos, zero ou mais.",
		],
	])("rejeita %j", async (extra, message) => {
		await expect(stores.cards.create({ name: "X", ...extra })).rejects.toMatchObject({
			code: "invalid",
			message,
		});
	});

	it("rejeita patch inválido sem alterar o cartão", async () => {
		const card = await stores.cards.create({ name: "Nubank", closingDay: 10, dueDay: 17 });
		await expect(stores.cards.update(card.id, { closingDay: 40 })).rejects.toMatchObject({ code: "invalid" });
		expect(await stores.cards.get(card.id)).toEqual(card);
		await expect(stores.cards.update("nada", { name: "X" })).rejects.toMatchObject({
			code: "not_found",
			message: "Cartão não encontrado.",
		});
	});
});
