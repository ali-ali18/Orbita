import { beforeEach, describe, expect, it } from "vitest";
import { contractSuites, seedBasics } from "./contract-harness.ts";
import type { Stores } from "./stores.ts";

describe.each(contractSuites())("IncomeSourceStore (%s)", (_name, make) => {
	let stores: Stores;
	beforeEach(async () => {
		stores = await make();
	});

	it("cria o salário (recorrente por padrão) e lista só as ativas, da mais antiga para a mais nova", async () => {
		const salary = await stores.incomeSources.create({ name: "  Salário ", amountCents: 230000, payday: 5 });
		const freela = await stores.incomeSources.create({
			name: "Freela",
			amountCents: 50000,
			payday: 20,
			recurring: false,
			month: "2026-11",
		});
		expect(salary).toMatchObject({
			name: "Salário",
			amountCents: 230000,
			payday: 5,
			accountId: null,
			recurring: true,
			month: null,
			archivedAt: null,
		});
		expect(freela).toMatchObject({ recurring: false, month: "2026-11" });
		expect(await stores.incomeSources.get(salary.id)).toEqual(salary);
		expect((await stores.incomeSources.list()).map((s) => s.id)).toEqual([salary.id, freela.id]);
		expect(await stores.incomeSources.get("nada")).toBeNull();
	});

	it("recorrente ignora o mês enviado", async () => {
		const s = await stores.incomeSources.create({
			name: "Salário",
			amountCents: 100,
			payday: 31,
			month: "2026-11",
		});
		expect(s.month).toBeNull();
	});

	it("liga a uma conta ativa; inexistente ou arquivada é recusada", async () => {
		const { checking } = await seedBasics(stores);
		const s = await stores.incomeSources.create({
			name: "Salário",
			amountCents: 100,
			payday: 5,
			accountId: checking.id,
		});
		expect(s.accountId).toBe(checking.id);
		await expect(
			stores.incomeSources.create({ name: "X", amountCents: 100, payday: 5, accountId: "fantasma" }),
		).rejects.toMatchObject({ code: "bad_reference" });
		const old = await stores.accounts.create({ name: "Antiga", kind: "savings" });
		await stores.accounts.archive(old.id);
		await expect(
			stores.incomeSources.create({ name: "X", amountCents: 100, payday: 5, accountId: old.id }),
		).rejects.toMatchObject({ code: "bad_reference", message: "A conta informada está arquivada." });
		// Quem já apontava para uma conta que depois foi arquivada continua podendo editar a renda.
		await stores.accounts.archive(checking.id);
		expect((await stores.incomeSources.update(s.id, { name: "Salário CLT" })).accountId).toBe(checking.id);
		expect((await stores.incomeSources.update(s.id, { accountId: null })).accountId).toBeNull();
	});

	it("rejeita dado inválido com a mesma mensagem", async () => {
		await expect(
			stores.incomeSources.create({ name: "  ", amountCents: 100, payday: 5 }),
		).rejects.toMatchObject({ code: "invalid", message: "Informe o nome da renda." });
		for (const amountCents of [0, -5, 10.5, Number.NaN]) {
			await expect(stores.incomeSources.create({ name: "X", amountCents, payday: 5 })).rejects.toMatchObject({
				code: "invalid",
				message: "O valor da renda deve ser um inteiro positivo, em centavos.",
			});
		}
		for (const payday of [0, 32, 1.5]) {
			await expect(
				stores.incomeSources.create({ name: "X", amountCents: 100, payday }),
			).rejects.toMatchObject({ code: "invalid", message: "O dia do pagamento deve ser um dia de 1 a 31." });
		}
		await expect(
			stores.incomeSources.create({ name: "X", amountCents: 100, payday: 5, recurring: false }),
		).rejects.toMatchObject({ code: "invalid", message: "Informe o mês da renda avulsa." });
		await expect(
			stores.incomeSources.create({
				name: "X",
				amountCents: 100,
				payday: 5,
				recurring: false,
				month: "2026-13",
			}),
		).rejects.toMatchObject({ code: "invalid", message: "O mês da renda é inválido (use AAAA-MM)." });
		expect(await stores.incomeSources.list()).toEqual([]);
	});

	it("atualiza, trocando entre recorrente e avulsa; campo ausente não muda", async () => {
		const s = await stores.incomeSources.create({ name: "Salário", amountCents: 230000, payday: 5 });
		const raise = await stores.incomeSources.update(s.id, { amountCents: 250000 });
		expect(raise).toMatchObject({ name: "Salário", amountCents: 250000, payday: 5, recurring: true });
		const once = await stores.incomeSources.update(s.id, { recurring: false, month: "2026-12" });
		expect(once).toMatchObject({ recurring: false, month: "2026-12" });
		const back = await stores.incomeSources.update(s.id, { recurring: true });
		expect(back).toMatchObject({ recurring: true, month: null });
		await expect(stores.incomeSources.update(s.id, { recurring: false })).rejects.toMatchObject({
			code: "invalid",
		});
		await expect(stores.incomeSources.update("nada", { name: "Y" })).rejects.toMatchObject({
			code: "not_found",
		});
	});

	it("arquivar esconde da lista, é idempotente e bloqueia a edição", async () => {
		const s = await stores.incomeSources.create({ name: "Freela", amountCents: 100, payday: 5 });
		const archived = await stores.incomeSources.archive(s.id);
		expect(archived.archivedAt).not.toBeNull();
		expect(await stores.incomeSources.archive(s.id)).toEqual(archived);
		expect(await stores.incomeSources.list()).toEqual([]);
		expect(await stores.incomeSources.get(s.id)).toEqual(archived);
		await expect(stores.incomeSources.update(s.id, { name: "Y" })).rejects.toMatchObject({
			code: "invalid",
			message: "A renda informada está arquivada.",
		});
		await expect(stores.incomeSources.archive("nada")).rejects.toMatchObject({ code: "not_found" });
	});
});
