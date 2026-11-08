import { beforeEach, describe, expect, it } from "vitest";
import { contractSuites } from "./contract-harness.ts";
import type { Stores } from "./stores.ts";

describe.each(contractSuites())("ChatStore (%s)", (_name, make) => {
	let stores: Stores;
	beforeEach(async () => {
		stores = await make();
	});

	it("cria a conversa com título saneado e cortado", async () => {
		const a = await stores.chat.createConversation("  quanto   gastei\n com delivery?  ");
		expect(a.title).toBe("quanto gastei com delivery?");
		const long = await stores.chat.createConversation("x".repeat(200));
		expect(long.title.length).toBe(60);
		expect(long.title.endsWith("…")).toBe(true);
		expect((await stores.chat.createConversation("   ")).title).toBe("Conversa");
		expect(await stores.chat.getConversation(a.id)).toEqual(a);
		expect(await stores.chat.getConversation("fantasma")).toBeNull();
	});

	it("acrescenta mensagens em ordem e a conversa mais recente vem primeiro", async () => {
		const first = await stores.chat.createConversation("Primeira");
		const second = await stores.chat.createConversation("Segunda");
		const m1 = await stores.chat.appendMessage(first.id, { role: "user", text: "Oi" });
		const m2 = await stores.chat.appendMessage(first.id, {
			role: "assistant",
			text: "Olá!",
			cards: [{ type: "rows", tool: "get_month_summary", title: "Resumo", rows: [], total: null }],
		});
		expect([m1.seq, m2.seq]).toEqual([1, 2]);
		expect(m2.cards).toEqual([
			{ type: "rows", tool: "get_month_summary", title: "Resumo", rows: [], total: null },
		]);
		expect((await stores.chat.appendMessage(second.id, { role: "user", text: "Outra" })).seq).toBe(1);

		const messages = await stores.chat.listMessages(first.id);
		expect(messages.map((m) => [m.seq, m.role, m.text])).toEqual([
			[1, "user", "Oi"],
			[2, "assistant", "Olá!"],
		]);
		// A última mensagem mexe na ordem da lista: a "Segunda" foi a última a receber uma.
		expect((await stores.chat.listConversations()).map((c) => c.title)).toEqual(["Segunda", "Primeira"]);
		await stores.chat.appendMessage(first.id, { role: "user", text: "De novo" });
		expect((await stores.chat.listConversations()).map((c) => c.title)).toEqual(["Primeira", "Segunda"]);
		expect((await stores.chat.listConversations({ limit: 1 })).map((c) => c.title)).toEqual(["Primeira"]);
	});

	it("lastN devolve só as últimas, em ordem crescente", async () => {
		const c = await stores.chat.createConversation("Conversa");
		for (const text of ["a", "b", "c", "d"]) await stores.chat.appendMessage(c.id, { role: "user", text });
		expect((await stores.chat.listMessages(c.id, { lastN: 2 })).map((m) => m.text)).toEqual(["c", "d"]);
		expect(await stores.chat.listMessages(c.id, { lastN: 0 })).toEqual([]);
		expect(await stores.chat.listMessages(c.id, { lastN: 10 })).toHaveLength(4);
		expect(await stores.chat.listMessages("fantasma")).toEqual([]);
	});

	it("recusa mensagem vazia do dono, papel inválido, texto enorme e conversa que não existe", async () => {
		const c = await stores.chat.createConversation("Conversa");
		await expect(stores.chat.appendMessage(c.id, { role: "user", text: "   " })).rejects.toMatchObject({
			code: "invalid",
		});
		await expect(
			// biome-ignore lint/suspicious/noExplicitAny: papel fora do tipo, como o que chegaria de um cliente
			stores.chat.appendMessage(c.id, { role: "system" as any, text: "x" }),
		).rejects.toMatchObject({ code: "invalid" });
		await expect(
			stores.chat.appendMessage(c.id, { role: "assistant", text: "x".repeat(20_001) }),
		).rejects.toMatchObject({ code: "invalid" });
		await expect(stores.chat.appendMessage("fantasma", { role: "user", text: "oi" })).rejects.toMatchObject({
			code: "not_found",
		});
		// A resposta da IA pode ser só cards.
		expect((await stores.chat.appendMessage(c.id, { role: "assistant", text: "" })).text).toBe("");
		expect(await stores.chat.listMessages(c.id)).toHaveLength(1);
	});

	it("gravações simultâneas ganham seq diferentes e seguidos", async () => {
		const c = await stores.chat.createConversation("Conversa");
		await Promise.all(
			Array.from({ length: 6 }, (_, i) => stores.chat.appendMessage(c.id, { role: "user", text: `m${i}` })),
		);
		const seqs = (await stores.chat.listMessages(c.id)).map((m) => m.seq);
		expect(seqs).toEqual([1, 2, 3, 4, 5, 6]);
	});

	it("apagar a conversa leva mensagens e propostas", async () => {
		const c = await stores.chat.createConversation("Conversa");
		await stores.chat.appendMessage(c.id, { role: "user", text: "oi" });
		const p = await stores.chat.createProposal(c.id, { kind: "create_transaction", payload: { a: 1 } });
		expect(await stores.chat.deleteConversation(c.id)).toBe(true);
		expect(await stores.chat.deleteConversation(c.id)).toBe(false);
		expect(await stores.chat.getConversation(c.id)).toBeNull();
		expect(await stores.chat.listMessages(c.id)).toEqual([]);
		expect(await stores.chat.getProposal(p.id)).toBeNull();
	});

	it("proposta: nasce pendente, guarda o payload e só muda de situação uma vez", async () => {
		const c = await stores.chat.createConversation("Conversa");
		const payload = { input: { amountCents: 4690 }, summary: { title: "Lançar gasto" } };
		const p = await stores.chat.createProposal(c.id, { kind: "create_transaction", payload });
		expect(p).toMatchObject({ status: "pending", result: null, resolvedAt: null, payload });
		expect(await stores.chat.getProposal(p.id)).toEqual(p);
		expect(await stores.chat.getProposals([p.id, "fantasma"])).toEqual([p]);
		expect(await stores.chat.getProposals([])).toEqual([]);

		// Duas confirmações ao mesmo tempo: só uma executa.
		const [a, b] = await Promise.all([
			stores.chat.transitionProposal(p.id, "pending", "confirmed", { result: { transactionId: "t1" } }),
			stores.chat.transitionProposal(p.id, "pending", "confirmed", { result: { transactionId: "t2" } }),
		]);
		expect([a, b].filter((x) => x !== null)).toHaveLength(1);
		const done = await stores.chat.getProposal(p.id);
		expect(done?.status).toBe("confirmed");
		expect(done?.resolvedAt).toBeInstanceOf(Date);
		expect([{ transactionId: "t1" }, { transactionId: "t2" }]).toContainEqual(done?.result);

		// Desfazer só vale a partir de "confirmed"; cancelar só a partir de "pending".
		expect(await stores.chat.transitionProposal(p.id, "pending", "canceled")).toBeNull();
		const undone = await stores.chat.transitionProposal(p.id, "confirmed", "undone");
		expect(undone?.status).toBe("undone");
		// Sem `result` no pedido, o resultado guardado continua.
		expect(undone?.result).toEqual(done?.result);
		expect(await stores.chat.transitionProposal("fantasma", "pending", "canceled")).toBeNull();
	});

	it("proposta de conversa que não existe é not_found", async () => {
		await expect(
			stores.chat.createProposal("fantasma", { kind: "create_transaction", payload: {} }),
		).rejects.toMatchObject({ code: "not_found" });
	});
});
