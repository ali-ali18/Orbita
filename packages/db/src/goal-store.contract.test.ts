import { beforeEach, describe, expect, it } from "vitest";
import { contractSuites, seedBasics } from "./contract-harness.ts";
import type { Stores } from "./stores.ts";

describe.each(contractSuites())("GoalStore (%s)", (_name, make) => {
	let stores: Stores;
	beforeEach(async () => {
		stores = await make();
	});

	it("recusa criar com um id que já existe (duplicate), sem mexer no original", async () => {
		const first = await stores.goals.create({ id: "meta-fixa", name: "Viagem", targetCents: 800000 });
		await expect(
			stores.goals.create({ id: "meta-fixa", name: "Outra", targetCents: 1000 }),
		).rejects.toMatchObject({ code: "duplicate" });
		expect((await stores.goals.get(first.id))?.name).toBe("Viagem");
	});

	it("cria com padrões, lê e lista só as ativas, da mais antiga para a mais nova", async () => {
		const a = await stores.goals.create({ name: "  Viagem para o Chile  ", targetCents: 800000 });
		const b = await stores.goals.create({
			name: "Notebook",
			targetCents: 100000,
			deadline: "2027-01-31",
			icon: "monitor",
			chartSlot: 3,
		});
		expect(a).toMatchObject({
			name: "Viagem para o Chile",
			targetCents: 800000,
			deadline: null,
			accountId: null,
			icon: "target",
			chartSlot: 0,
			archivedAt: null,
		});
		expect(b).toMatchObject({ deadline: "2027-01-31", icon: "monitor", chartSlot: 3 });
		expect(await stores.goals.get(a.id)).toEqual(a);
		expect((await stores.goals.list()).map((g) => g.id)).toEqual([a.id, b.id]);
		expect(await stores.goals.get("nada")).toBeNull();
	});

	it("liga a uma conta ativa; conta inexistente ou arquivada é recusada", async () => {
		const { checking } = await seedBasics(stores);
		const goal = await stores.goals.create({ name: "Reserva", targetCents: 300000, accountId: checking.id });
		expect(goal.accountId).toBe(checking.id);
		await expect(
			stores.goals.create({ name: "X", targetCents: 100, accountId: "fantasma" }),
		).rejects.toMatchObject({ code: "bad_reference" });
		const old = await stores.accounts.create({ name: "Antiga", kind: "savings" });
		await stores.accounts.archive(old.id);
		await expect(
			stores.goals.create({ name: "X", targetCents: 100, accountId: old.id }),
		).rejects.toMatchObject({ code: "bad_reference", message: "A conta informada está arquivada." });
		// Quem já apontava para uma conta que depois foi arquivada continua podendo editar a meta.
		const linked = await stores.goals.create({ name: "Y", targetCents: 100, accountId: checking.id });
		await stores.accounts.archive(checking.id);
		expect((await stores.goals.update(linked.id, { name: "Y2" })).accountId).toBe(checking.id);
		expect((await stores.goals.update(linked.id, { accountId: null })).accountId).toBeNull();
	});

	it("rejeita dado inválido com a mesma mensagem", async () => {
		await expect(stores.goals.create({ name: "  ", targetCents: 100 })).rejects.toMatchObject({
			code: "invalid",
			message: "Informe o nome da meta.",
		});
		for (const targetCents of [0, -5, 10.5, Number.NaN]) {
			await expect(stores.goals.create({ name: "X", targetCents })).rejects.toMatchObject({
				code: "invalid",
				message: "O valor da meta deve ser um inteiro positivo, em centavos.",
			});
		}
		await expect(
			stores.goals.create({ name: "X", targetCents: 100, deadline: "2027-02-30" }),
		).rejects.toMatchObject({
			code: "invalid",
			message: "A data do prazo é inválida (use AAAA-MM-DD).",
		});
		await expect(stores.goals.create({ name: "X", targetCents: 100, chartSlot: 10 })).rejects.toMatchObject({
			code: "invalid",
			message: "A cor da meta vai de 0 a 9.",
		});
		await expect(
			// @ts-expect-error ícone fora da lista
			stores.goals.create({ name: "X", targetCents: 100, icon: "foguete" }),
		).rejects.toMatchObject({ code: "invalid", message: "Ícone de meta inválido." });
		expect(await stores.goals.list()).toEqual([]);
	});

	it("atualiza só o que veio no patch; null limpa prazo e conta", async () => {
		const goal = await stores.goals.create({
			name: "Viagem",
			targetCents: 800000,
			deadline: "2027-07-31",
		});
		const renamed = await stores.goals.update(goal.id, { name: "Chile", targetCents: 900000 });
		expect(renamed).toMatchObject({ name: "Chile", targetCents: 900000, deadline: "2027-07-31" });
		expect(renamed.updatedAt.getTime()).toBeGreaterThan(goal.updatedAt.getTime());
		expect((await stores.goals.update(goal.id, { deadline: null })).deadline).toBeNull();
		await expect(stores.goals.update(goal.id, { targetCents: 0 })).rejects.toMatchObject({ code: "invalid" });
		expect((await stores.goals.get(goal.id))?.targetCents).toBe(900000);
		await expect(stores.goals.update("nada", { name: "X" })).rejects.toMatchObject({
			code: "not_found",
			message: "Meta não encontrada.",
		});
	});

	it("arquivar esconde da lista, mantém o get, é idempotente e trava edição e contribuição", async () => {
		const goal = await stores.goals.create({ name: "Velha", targetCents: 1000 });
		const archived = await stores.goals.archive(goal.id);
		expect(archived.archivedAt).toBeInstanceOf(Date);
		expect(await stores.goals.list()).toEqual([]);
		expect((await stores.goals.get(goal.id))?.archivedAt).toEqual(archived.archivedAt);
		expect((await stores.goals.archive(goal.id)).archivedAt).toEqual(archived.archivedAt);
		await expect(stores.goals.update(goal.id, { name: "X" })).rejects.toMatchObject({
			code: "invalid",
			message: "A meta informada está arquivada.",
		});
		await expect(
			stores.goals.addContribution(goal.id, { amountCents: 100, date: "2026-11-01" }),
		).rejects.toMatchObject({ code: "invalid" });
		await expect(stores.goals.archive("nada")).rejects.toMatchObject({ code: "not_found" });
	});
});

describe.each(contractSuites())("GoalStore: contribuições (%s)", (_name, make) => {
	let stores: Stores;
	beforeEach(async () => {
		stores = await make();
	});

	it("guarda, lista da mais recente para a mais antiga e remove", async () => {
		const goal = await stores.goals.create({ name: "Viagem", targetCents: 800000 });
		const other = await stores.goals.create({ name: "Outra", targetCents: 1000 });
		const a = await stores.goals.addContribution(goal.id, { amountCents: 50000, date: "2026-10-05" });
		const b = await stores.goals.addContribution(goal.id, { amountCents: 70000, date: "2026-11-02" });
		const c = await stores.goals.addContribution(goal.id, { amountCents: 1000, date: "2026-11-02" });
		await stores.goals.addContribution(other.id, { amountCents: 200, date: "2026-11-03" });
		expect(a).toMatchObject({ goalId: goal.id, amountCents: 50000, date: "2026-10-05", transactionId: null });
		expect((await stores.goals.listContributions([goal.id])).map((x) => x.id)).toEqual([c.id, b.id, a.id]);
		expect(await stores.goals.listContributions([])).toEqual([]);
		expect(await stores.goals.listContributions([goal.id, other.id])).toHaveLength(4);
		await stores.goals.removeContribution(goal.id, b.id);
		expect((await stores.goals.listContributions([goal.id])).map((x) => x.id)).toEqual([c.id, a.id]);
	});

	it("valida valor e data, e a meta precisa existir", async () => {
		const goal = await stores.goals.create({ name: "Viagem", targetCents: 800000 });
		for (const amountCents of [0, -1, 1.5]) {
			await expect(
				stores.goals.addContribution(goal.id, { amountCents, date: "2026-11-01" }),
			).rejects.toMatchObject({ code: "invalid" });
		}
		await expect(
			stores.goals.addContribution(goal.id, { amountCents: 100, date: "01/11/2026" }),
		).rejects.toMatchObject({ code: "invalid", message: "A data é inválida (use AAAA-MM-DD)." });
		await expect(
			stores.goals.addContribution("nada", { amountCents: 100, date: "2026-11-01" }),
		).rejects.toMatchObject({ code: "not_found", message: "Meta não encontrada." });
		expect(await stores.goals.listContributions([goal.id])).toEqual([]);
	});

	it("o lançamento de origem precisa existir e não estar apagado", async () => {
		const { checking, food } = await seedBasics(stores);
		const goal = await stores.goals.create({ name: "Viagem", targetCents: 800000 });
		const tx = await stores.transactions.create({
			kind: "expense",
			amountCents: 5000,
			date: "2026-11-02",
			description: "Transferência para a reserva",
			accountId: checking.id,
			categoryId: food.id,
		});
		const ok = await stores.goals.addContribution(goal.id, {
			amountCents: 5000,
			date: "2026-11-02",
			transactionId: tx.id,
		});
		expect(ok.transactionId).toBe(tx.id);
		await expect(
			stores.goals.addContribution(goal.id, {
				amountCents: 100,
				date: "2026-11-02",
				transactionId: "fantasma",
			}),
		).rejects.toMatchObject({ code: "bad_reference", message: "O lançamento informado não existe." });
		await stores.transactions.softDelete(tx.id);
		await expect(
			stores.goals.addContribution(goal.id, { amountCents: 100, date: "2026-11-02", transactionId: tx.id }),
		).rejects.toMatchObject({ code: "bad_reference" });
	});

	it("remover uma contribuição de outra meta ou inexistente é not_found e não apaga nada", async () => {
		const a = await stores.goals.create({ name: "A", targetCents: 1000 });
		const b = await stores.goals.create({ name: "B", targetCents: 1000 });
		const c = await stores.goals.addContribution(a.id, { amountCents: 100, date: "2026-11-01" });
		await expect(stores.goals.removeContribution(b.id, c.id)).rejects.toMatchObject({
			code: "not_found",
			message: "Contribuição não encontrada.",
		});
		await expect(stores.goals.removeContribution(a.id, "nada")).rejects.toMatchObject({ code: "not_found" });
		expect(await stores.goals.listContributions([a.id])).toHaveLength(1);
	});

	it("arquivar mantém as contribuições", async () => {
		const goal = await stores.goals.create({ name: "A", targetCents: 1000 });
		await stores.goals.addContribution(goal.id, { amountCents: 100, date: "2026-11-01" });
		await stores.goals.archive(goal.id);
		expect(await stores.goals.listContributions([goal.id])).toHaveLength(1);
	});
});

describe.each(contractSuites())("GoalStore: sobra do mês (%s)", (_name, make) => {
	let stores: Stores;
	beforeEach(async () => {
		stores = await make();
	});

	it("a meta da sobra precisa existir e estar ativa", async () => {
		const goal = await stores.goals.create({ name: "Viagem", targetCents: 800000 });
		expect((await stores.preferences.update({ leftoverGoalId: goal.id })).leftoverGoalId).toBe(goal.id);
		await expect(stores.preferences.update({ leftoverGoalId: "fantasma" })).rejects.toMatchObject({
			code: "bad_reference",
			message: "A meta informada não existe.",
		});
		const old = await stores.goals.create({ name: "Velha", targetCents: 1000 });
		await stores.goals.archive(old.id);
		await expect(stores.preferences.update({ leftoverGoalId: old.id })).rejects.toMatchObject({
			code: "bad_reference",
			message: "A meta informada está arquivada.",
		});
		expect((await stores.preferences.get()).leftoverGoalId).toBe(goal.id);
		expect((await stores.preferences.update({ leftoverGoalId: null })).leftoverGoalId).toBeNull();
	});

	it("conta e meta da sobra não convivem: escolher uma desfaz a outra", async () => {
		const { savings } = await seedBasics(stores);
		const goal = await stores.goals.create({ name: "Viagem", targetCents: 800000 });
		await stores.preferences.update({ leftoverAccountId: savings.id });
		const withGoal = await stores.preferences.update({ leftoverGoalId: goal.id });
		expect(withGoal).toMatchObject({ leftoverAccountId: null, leftoverGoalId: goal.id });
		const withAccount = await stores.preferences.update({ leftoverAccountId: savings.id });
		expect(withAccount).toMatchObject({ leftoverAccountId: savings.id, leftoverGoalId: null });
		// Limpar uma não mexe na outra.
		await stores.preferences.update({ leftoverGoalId: goal.id });
		expect(await stores.preferences.update({ leftoverAccountId: null })).toMatchObject({
			leftoverAccountId: null,
			leftoverGoalId: goal.id,
		});
		await expect(
			stores.preferences.update({ leftoverAccountId: savings.id, leftoverGoalId: goal.id }),
		).rejects.toMatchObject({
			code: "invalid",
			message: "A sobra vai para uma conta ou para uma meta, não para as duas.",
		});
		expect((await stores.preferences.get()).leftoverGoalId).toBe(goal.id);
	});

	it("arquivar a meta desfaz a escolha da sobra", async () => {
		const goal = await stores.goals.create({ name: "Viagem", targetCents: 800000 });
		const other = await stores.goals.create({ name: "Outra", targetCents: 1000 });
		await stores.preferences.update({ leftoverGoalId: goal.id, displayName: "Ana" });
		await stores.goals.archive(other.id);
		expect((await stores.preferences.get()).leftoverGoalId).toBe(goal.id);
		await stores.goals.archive(goal.id);
		expect(await stores.preferences.get()).toMatchObject({ leftoverGoalId: null, displayName: "Ana" });
	});
});
