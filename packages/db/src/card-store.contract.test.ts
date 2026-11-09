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

	it("guarda a origem da regra de fechamento: padrão, escolha do dono ou deduzida pelo sync", async () => {
		const base = { name: "N", closingDay: 10, dueDay: 17 };
		expect((await stores.cards.create(base)).closingRuleSource).toBe("default");
		const owned = await stores.cards.create({ ...base, closingRule: "closing-day-included" });
		expect(owned.closingRuleSource).toBe("owner");
		const card = await stores.cards.create(base);
		// Trocar a regra sem dizer a origem é do dono; outra edição não mexe na origem.
		expect((await stores.cards.update(card.id, { limitCents: 100_00 })).closingRuleSource).toBe("default");
		expect((await stores.cards.update(card.id, { closingRule: "closing-day-next" })).closingRuleSource).toBe(
			"owner",
		);
		const inferred = await stores.cards.update(card.id, {
			closingRule: "closing-day-included",
			closingRuleSource: "inferred",
		});
		expect(inferred).toMatchObject({ closingRule: "closing-day-included", closingRuleSource: "inferred" });
		expect((await stores.cards.get(card.id))?.closingRuleSource).toBe("inferred");
		await expect(stores.cards.update(card.id, { closingRuleSource: "x" as never })).rejects.toThrow();
	});

	it("relinkExternal troca só o id externo; manual, inexistente ou id em uso dão null", async () => {
		const base = { closingDay: 10, dueDay: 17, source: "pluggy" as const };
		const c = await stores.cards.create({ name: "N", last4: "1234", externalId: "old", ...base });
		await stores.cards.create({ name: "O", externalId: "busy", ...base });
		const manual = await stores.cards.create({ name: "M", closingDay: 1, dueDay: 8 });
		const moved = await stores.cards.relinkExternal(c.id, "new");
		expect(moved).toMatchObject({ id: c.id, name: "N", last4: "1234", externalId: "new" });
		expect(await stores.cards.findByExternal("pluggy", "old")).toBeNull();
		expect(await stores.cards.relinkExternal(c.id, "busy")).toBeNull();
		expect(await stores.cards.relinkExternal(manual.id, "x")).toBeNull();
		expect(await stores.cards.relinkExternal("nada", "x")).toBeNull();
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

describe.each(contractSuites())("CardStore: cadastro de fora (%s)", (_name, make) => {
	let stores: Stores;
	beforeEach(async () => {
		stores = await make();
	});

	it("liga o cartão ao id externo, não repete e preserva a identidade no update", async () => {
		const card = await stores.cards.create({
			name: "Nubank",
			closingDay: 10,
			dueDay: 17,
			source: "pluggy",
			externalId: "card-1",
		});
		expect(card).toMatchObject({ source: "pluggy", externalId: "card-1" });
		expect(await stores.cards.findByExternal("pluggy", "card-1")).toEqual(card);
		expect(await stores.cards.findByExternal("pluggy", "nada")).toBeNull();
		await expect(
			stores.cards.create({
				name: "Outro",
				closingDay: 1,
				dueDay: 8,
				source: "pluggy",
				externalId: "card-1",
			}),
		).rejects.toMatchObject({ code: "duplicate" });
		expect(await stores.cards.update(card.id, { limitCents: 500_000 })).toMatchObject({
			source: "pluggy",
			externalId: "card-1",
			limitCents: 500_000,
		});
		await stores.cards.archive(card.id);
		expect((await stores.cards.findByExternal("pluggy", "card-1"))?.id).toBe(card.id);
	});

	it("cartão manual não tem id externo", async () => {
		const manual = await stores.cards.create({ name: "M", closingDay: 1, dueDay: 8 });
		expect(manual).toMatchObject({ source: "manual", externalId: null });
		await expect(
			stores.cards.create({ name: "M", closingDay: 1, dueDay: 8, externalId: "x" }),
		).rejects.toMatchObject({ code: "invalid" });
	});

	it("grava o limite disponível do banco sem mexer em updatedAt e sem perder ao editar", async () => {
		const c = await stores.cards.create({ name: "N", closingDay: 10, dueDay: 17, limitCents: 577_000 });
		expect(c).toMatchObject({ availableCents: null, limitSyncedAt: null });
		const at = new Date("2026-11-09T12:00:00Z");
		const saved = await stores.cards.recordAvailable(c.id, 523_267, at);
		expect(saved).toMatchObject({
			availableCents: 523_267,
			limitSyncedAt: at,
			limitCents: 577_000,
			updatedAt: c.updatedAt,
		});
		const edited = await stores.cards.update(c.id, { dueDay: 20 });
		expect(edited).toMatchObject({ availableCents: 523_267, limitSyncedAt: at });
		expect(await stores.cards.get(c.id)).toEqual(edited);
		// O saldo do cartão acompanha o disponível; ausente na leitura grava null (nunca mantém o de outra rodada).
		expect(saved.balanceCents).toBeNull();
		const withBalance = await stores.cards.recordAvailable(c.id, 150_000, at, 50_000);
		expect(withBalance).toMatchObject({ availableCents: 150_000, balanceCents: 50_000 });
		expect(await stores.cards.recordAvailable(c.id, 150_000, at)).toMatchObject({ balanceCents: null });
		await stores.cards.recordAvailable(c.id, 150_000, at, 50_000);
		expect(await stores.cards.recordAvailable(c.id, 150_000, at, null)).toMatchObject({
			balanceCents: null,
		});
		await expect(stores.cards.recordAvailable(c.id, 1, at, 2.5)).rejects.toMatchObject({ code: "invalid" });
		await expect(stores.cards.recordAvailable("nada", 1, at)).rejects.toMatchObject({ code: "not_found" });
		await expect(stores.cards.recordAvailable(c.id, 1.5, at)).rejects.toMatchObject({ code: "invalid" });
	});
});
