import { beforeEach, describe, expect, it } from "vitest";
import { contractSuites } from "./contract-harness.ts";
import type { Stores } from "./stores.ts";

describe.each(contractSuites())("AccountStore (%s)", (_name, make) => {
	let stores: Stores;
	beforeEach(async () => {
		stores = await make();
	});

	it("cria, lê e lista só as ativas", async () => {
		const a = await stores.accounts.create({ name: "  Itaú  ", kind: "checking", bankCode: "60701190" });
		const b = await stores.accounts.create({ name: "Carteira", kind: "wallet" });
		expect(a).toMatchObject({ name: "Itaú", kind: "checking", bankCode: "60701190", archivedAt: null });
		expect(b.bankCode).toBeNull();
		expect(await stores.accounts.get(a.id)).toEqual(a);
		expect((await stores.accounts.list()).map((x) => x.id)).toEqual([a.id, b.id]);
	});

	it("atualiza só o que veio no patch e limpa o banco com null", async () => {
		const a = await stores.accounts.create({ name: "Itaú", kind: "checking", bankCode: "60701190" });
		const renamed = await stores.accounts.update(a.id, { name: "Itaú PJ" });
		expect(renamed).toMatchObject({ name: "Itaú PJ", kind: "checking", bankCode: "60701190" });
		expect(renamed.updatedAt.getTime()).toBeGreaterThan(a.updatedAt.getTime());
		expect((await stores.accounts.update(a.id, { bankCode: null })).bankCode).toBeNull();
	});

	it("arquivar esconde da lista, mantém o get e é idempotente", async () => {
		const a = await stores.accounts.create({ name: "Velha", kind: "savings" });
		const archived = await stores.accounts.archive(a.id);
		expect(archived.archivedAt).toBeInstanceOf(Date);
		expect(await stores.accounts.list()).toEqual([]);
		expect((await stores.accounts.get(a.id))?.archivedAt).toEqual(archived.archivedAt);
		expect((await stores.accounts.archive(a.id)).archivedAt).toEqual(archived.archivedAt);
	});

	it("rejeita dado inválido com a mesma mensagem", async () => {
		await expect(stores.accounts.create({ name: "  ", kind: "checking" })).rejects.toMatchObject({
			name: "DataError",
			code: "invalid",
			message: "Informe o nome da conta.",
		});
		await expect(
			// @ts-expect-error tipo fora do enum
			stores.accounts.create({ name: "X", kind: "crypto" }),
		).rejects.toMatchObject({ code: "invalid", message: "Tipo de conta inválido." });
	});

	it("not_found para conta que não existe", async () => {
		await expect(stores.accounts.update("nada", { name: "X" })).rejects.toMatchObject({
			code: "not_found",
			message: "Conta não encontrada.",
		});
		await expect(stores.accounts.archive("nada")).rejects.toMatchObject({ code: "not_found" });
		expect(await stores.accounts.get("nada")).toBeNull();
	});
});

describe.each(contractSuites())("AccountStore: cadastro de fora (%s)", (_name, make) => {
	let stores: Stores;
	beforeEach(async () => {
		stores = await make();
	});

	it("liga a conta ao id externo e acha de novo, mesmo arquivada", async () => {
		const manual = await stores.accounts.create({ name: "Manual", kind: "checking" });
		expect(manual).toMatchObject({ source: "manual", externalId: null });
		const a = await stores.accounts.create({
			name: "Nubank",
			kind: "checking",
			source: "pluggy",
			externalId: " acc-1 ",
		});
		expect(a).toMatchObject({ source: "pluggy", externalId: "acc-1" });
		expect(await stores.accounts.findByExternal("pluggy", "acc-1")).toEqual(a);
		expect(await stores.accounts.findByExternal("pluggy", "outra")).toBeNull();
		expect(await stores.accounts.findByExternal("import", "acc-1")).toBeNull();
		await stores.accounts.archive(a.id);
		expect((await stores.accounts.findByExternal("pluggy", "acc-1"))?.id).toBe(a.id);
	});

	it("não repete o id externo da mesma origem e a identidade não muda no update", async () => {
		const a = await stores.accounts.create({
			name: "A",
			kind: "checking",
			source: "pluggy",
			externalId: "x",
		});
		await expect(
			stores.accounts.create({ name: "B", kind: "checking", source: "pluggy", externalId: "x" }),
		).rejects.toMatchObject({ code: "duplicate" });
		const renamed = await stores.accounts.update(a.id, { name: "A2" });
		expect(renamed).toMatchObject({ source: "pluggy", externalId: "x" });
	});

	it("relinkExternal troca só o id externo; manual, inexistente ou id em uso dão null", async () => {
		const a = await stores.accounts.create({
			name: "A",
			kind: "checking",
			source: "pluggy",
			externalId: "old",
		});
		await stores.accounts.create({ name: "B", kind: "checking", source: "pluggy", externalId: "busy" });
		const manual = await stores.accounts.create({ name: "M", kind: "checking" });
		const moved = await stores.accounts.relinkExternal(a.id, " new ");
		expect(moved).toMatchObject({ id: a.id, name: "A", source: "pluggy", externalId: "new" });
		expect(await stores.accounts.findByExternal("pluggy", "old")).toBeNull();
		expect((await stores.accounts.findByExternal("pluggy", "new"))?.id).toBe(a.id);
		expect(await stores.accounts.relinkExternal(a.id, "busy")).toBeNull();
		expect(await stores.accounts.relinkExternal(manual.id, "x")).toBeNull();
		expect(await stores.accounts.relinkExternal("nada", "x")).toBeNull();
		expect(await stores.accounts.relinkExternal(a.id, "  ")).toBeNull();
	});

	it("origem de fora exige id externo e cadastro manual não aceita", async () => {
		await expect(
			stores.accounts.create({ name: "A", kind: "checking", source: "pluggy" }),
		).rejects.toMatchObject({
			code: "invalid",
			message: "Informe o identificador externo.",
		});
		await expect(
			stores.accounts.create({ name: "A", kind: "checking", externalId: "x" }),
		).rejects.toMatchObject({ code: "invalid" });
	});

	it("grava o saldo do banco (inclusive negativo) sem mexer em updatedAt e sem perder ao editar", async () => {
		const a = await stores.accounts.create({ name: "MP", kind: "checking" });
		expect(a).toMatchObject({ balanceCents: null, balanceSyncedAt: null });
		const at = new Date("2026-11-09T12:00:00Z");
		const saved = await stores.accounts.recordBalance(a.id, 20_535, at);
		expect(saved).toMatchObject({ balanceCents: 20_535, balanceSyncedAt: at, updatedAt: a.updatedAt });
		const later = new Date("2026-11-10T12:00:00Z");
		expect((await stores.accounts.recordBalance(a.id, -1_500, later)).balanceCents).toBe(-1_500);
		const renamed = await stores.accounts.update(a.id, { name: "Mercado Pago" });
		expect(renamed).toMatchObject({ balanceCents: -1_500, balanceSyncedAt: later });
		expect(await stores.accounts.get(a.id)).toEqual(renamed);
	});

	it("saldo: conta inexistente e valor que não é centavo inteiro são recusados", async () => {
		const a = await stores.accounts.create({ name: "MP", kind: "checking" });
		await expect(stores.accounts.recordBalance("nada", 1, new Date())).rejects.toMatchObject({
			code: "not_found",
		});
		await expect(stores.accounts.recordBalance(a.id, 10.5, new Date())).rejects.toMatchObject({
			code: "invalid",
		});
	});
});
