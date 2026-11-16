import { beforeEach, describe, expect, it } from "vitest";
import { contractSuites } from "./contract-harness.ts";
import { DataError } from "./errors.ts";
import type { Stores } from "./stores.ts";

describe.each(contractSuites())("NotificationCardLinkStore (%s)", (_name, make) => {
	let stores: Stores;
	let cardId: string;
	let otherId: string;
	beforeEach(async () => {
		stores = await make();
		cardId = (await stores.cards.create({ name: "Cartão A", closingDay: 10, dueDay: 20 })).id;
		otherId = (await stores.cards.create({ name: "Cartão B", closingDay: 10, dueDay: 20 })).id;
	});

	it("não tem ligação até alguém criar", async () => {
		expect(await stores.notificationCardLinks.get("santander", "1234")).toBeNull();
	});

	it("liga o final de um app a um cartão e devolve na leitura", async () => {
		const saved = await stores.notificationCardLinks.set("santander", "1234", cardId);
		expect(saved).toMatchObject({ app: "santander", last4: "1234", cardId });
		expect(await stores.notificationCardLinks.get("santander", "1234")).toMatchObject({ cardId });
	});

	it("o mesmo final em outro banco é outra ligação", async () => {
		await stores.notificationCardLinks.set("santander", "1234", cardId);
		await stores.notificationCardLinks.set("nubank", "1234", otherId);
		expect((await stores.notificationCardLinks.get("santander", "1234"))?.cardId).toBe(cardId);
		expect((await stores.notificationCardLinks.get("nubank", "1234"))?.cardId).toBe(otherId);
	});

	it("ligar de novo troca o cartão e mantém uma só linha", async () => {
		const first = await stores.notificationCardLinks.set("santander", "1234", cardId);
		const second = await stores.notificationCardLinks.set("santander", "1234", otherId);
		expect(second.cardId).toBe(otherId);
		expect(second.createdAt).toEqual(first.createdAt);
		expect((await stores.notificationCardLinks.get("santander", "1234"))?.cardId).toBe(otherId);
	});

	it("recusa final que não tem 4 dígitos e cartão que não existe", async () => {
		await expect(stores.notificationCardLinks.set("santander", "12", cardId)).rejects.toMatchObject({
			code: "invalid",
		});
		const error = await stores.notificationCardLinks
			.set("santander", "1234", "nao-existe")
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(DataError);
		expect((error as DataError).code).toBe("not_found");
	});

	it("lista as ligações e esquece uma delas", async () => {
		await stores.notificationCardLinks.set("santander", "1234", cardId);
		await stores.notificationCardLinks.set("nubank", "5678", otherId);
		expect((await stores.notificationCardLinks.list()).map((l) => `${l.app}:${l.last4}`).sort()).toEqual([
			"nubank:5678",
			"santander:1234",
		]);
		expect(await stores.notificationCardLinks.remove("santander", "1234")).toBe(true);
		expect(await stores.notificationCardLinks.remove("santander", "1234")).toBe(false);
		expect(await stores.notificationCardLinks.get("santander", "1234")).toBeNull();
		expect(await stores.notificationCardLinks.list()).toHaveLength(1);
	});

	it("guarda a origem da ligação (palpite ou escolha) e a escolha troca o palpite", async () => {
		const guess = await stores.notificationCardLinks.set("santander", "1234", cardId, "guess");
		expect(guess.origin).toBe("guess");
		const chosen = await stores.notificationCardLinks.set("santander", "1234", otherId);
		expect(chosen).toMatchObject({ origin: "choice", cardId: otherId });
		expect((await stores.notificationCardLinks.get("santander", "1234"))?.origin).toBe("choice");
	});
});
