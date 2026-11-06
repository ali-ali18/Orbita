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
