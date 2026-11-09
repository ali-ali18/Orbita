import { BUILTIN_AGENTS } from "@orbita/shared";
import { beforeEach, describe, expect, it } from "vitest";
import type { ActivityDraft } from "./agent-activity-store.ts";
import { contractSuites } from "./contract-harness.ts";
import { DataError } from "./errors.ts";
import type { Stores } from "./stores.ts";

const draft = (over: Partial<ActivityDraft> = {}): ActivityDraft => ({
	kind: "categorize_transaction",
	dedupeKey: "categorize:tx-1",
	summary: "Categorizei um lançamento",
	reason: "Uma regra que você ensinou casa com o estabelecimento.",
	evidence: { transactionIds: ["tx-1"] },
	undo: { transactionId: "tx-1", categoryId: "c", previousCategoryId: null },
	...over,
});

describe.each(contractSuites())("AgentActivityStore (%s)", (_name, make) => {
	let stores: Stores;
	let agentId: string;
	/** Reserva e conclui (o caminho normal de uma ação feita). */
	const concluded = async (d: ActivityDraft = draft()) => {
		const rec = (await stores.agentActivity.reserve(agentId, d)) as { id: string };
		await stores.agentActivity.finish(rec.id, d.undo);
		return rec;
	};
	beforeEach(async () => {
		stores = await make();
		const info = BUILTIN_AGENTS.economia;
		await stores.agents.ensureBuiltins([
			{
				builtinKey: "economia",
				name: info.name,
				enabled: true,
				frequency: info.defaultSchedule.frequency,
				runHour: info.defaultSchedule.hour,
				runDay: info.defaultSchedule.day,
				settings: info.defaultSettings,
			},
		]);
		agentId = (await stores.agents.list())[0]?.id as string;
	});

	it("reserva a ação uma vez por achado: a segunda reserva da mesma chave devolve null", async () => {
		const first = await stores.agentActivity.reserve(agentId, draft());
		expect(first).toMatchObject({
			agentId,
			kind: "categorize_transaction",
			dedupeKey: "categorize:tx-1",
			status: "applying",
			undoneAt: null,
			undoNote: null,
			undo: { transactionId: "tx-1", categoryId: "c", previousCategoryId: null },
			evidence: { transactionIds: ["tx-1"] },
		});
		expect(await stores.agentActivity.reserve(agentId, draft())).toBeNull();
		expect(
			await stores.agentActivity.reserve(agentId, draft({ dedupeKey: "categorize:tx-2" })),
		).not.toBeNull();
		expect(await stores.agentActivity.list()).toHaveLength(2);
	});

	it("o Desfazer já vem gravado na reserva; concluir troca applying por done uma vez só e completa o undo", async () => {
		const rec = (await stores.agentActivity.reserve(agentId, draft())) as { id: string };
		// Enquanto está applying não se desfaz (nada garante que a ação já gravou).
		expect(await stores.agentActivity.markUndone(rec.id)).toBeNull();
		const [one, two] = await Promise.all([
			stores.agentActivity.finish(rec.id, { transactionId: "tx-1", extra: 1 }),
			stores.agentActivity.finish(rec.id, { transactionId: "tx-1", extra: 2 }),
		]);
		expect([one, two].filter((r) => r !== null)).toHaveLength(1);
		expect((await stores.agentActivity.get(rec.id))?.status).toBe("done");
		expect(await stores.agentActivity.finish(rec.id, {})).toBeNull();
		expect(await stores.agentActivity.finish("nao-existe", {})).toBeNull();
	});

	it("solta a reserva só quando pedido: o achado pode ser tentado de novo", async () => {
		const rec = (await stores.agentActivity.reserve(agentId, draft())) as { id: string };
		expect(await stores.agentActivity.release(rec.id)).toBe(true);
		expect(await stores.agentActivity.release(rec.id)).toBe(false);
		expect(await stores.agentActivity.reserve(agentId, draft())).not.toBeNull();
	});

	it("lista do mais novo para o mais antigo, com limite, e dá as chaves (inclusive as desfeitas)", async () => {
		const a = await concluded(draft({ dedupeKey: "a" }));
		await concluded(draft({ dedupeKey: "b" }));
		await concluded(draft({ dedupeKey: "c" }));
		expect((await stores.agentActivity.list()).map((r) => r.dedupeKey)).toEqual(["c", "b", "a"]);
		expect(await stores.agentActivity.list({ limit: 2 })).toHaveLength(2);
		expect(await stores.agentActivity.list({ agentId: "outro" })).toEqual([]);
		await stores.agentActivity.markUndone(a.id);
		expect(await stores.agentActivity.keys(agentId)).toEqual(new Set(["a", "b", "c"]));
	});

	it("desfaz uma vez só (comparar-e-trocar) e o que foi desfeito não pode ser reservado de novo", async () => {
		const rec = await concluded();
		const [one, two] = await Promise.all([
			stores.agentActivity.markUndone(rec.id, "  Você já tinha mudado a categoria.  "),
			stores.agentActivity.markUndone(rec.id),
		]);
		expect([one, two].filter((r) => r !== null)).toHaveLength(1);
		const done = (one ?? two) as { status: string; undoneAt: Date | null; undoNote: string | null };
		expect(done.status).toBe("undone");
		expect(done.undoneAt).toBeInstanceOf(Date);
		expect(await stores.agentActivity.markUndone(rec.id)).toBeNull();
		expect(await stores.agentActivity.reserve(agentId, draft())).toBeNull();
		expect((await stores.agentActivity.get(rec.id))?.status).toBe("undone");
	});

	it("reabre quando o Desfazer falha no meio", async () => {
		const rec = await concluded();
		await stores.agentActivity.markUndone(rec.id, "nota");
		const reopened = await stores.agentActivity.reopen(rec.id);
		expect(reopened).toMatchObject({ status: "done", undoneAt: null, undoNote: null });
		expect(await stores.agentActivity.markUndone(rec.id)).not.toBeNull();
		expect(await stores.agentActivity.reopen("nao-existe")).toBeNull();
	});

	it("anota por que o Desfazer não mexeu em nada", async () => {
		const rec = await concluded();
		await stores.agentActivity.markUndone(rec.id);
		const noted = await stores.agentActivity.setUndoNote(rec.id, "  Você já tinha mudado.  ");
		expect(noted?.undoNote).toBe("Você já tinha mudado.");
		expect(await stores.agentActivity.setUndoNote("nao-existe", "x")).toBeNull();
	});

	it("recusa agente inexistente, tipo desconhecido e texto vazio ou grande demais", async () => {
		await expect(stores.agentActivity.reserve("nao-existe", draft())).rejects.toMatchObject({
			code: "not_found",
		});
		await expect(
			stores.agentActivity.reserve(agentId, draft({ kind: "delete_transaction" as never })),
		).rejects.toBeInstanceOf(DataError);
		await expect(stores.agentActivity.reserve(agentId, draft({ summary: "   " }))).rejects.toMatchObject({
			code: "invalid",
		});
		await expect(
			stores.agentActivity.reserve(agentId, draft({ reason: "x".repeat(400) })),
		).rejects.toMatchObject({ code: "invalid" });
	});

	it("guarda só ids únicos de evidência e limita a 20", async () => {
		const ids = Array.from({ length: 30 }, (_, i) => `tx-${i}`);
		const rec = await stores.agentActivity.reserve(
			agentId,
			draft({ evidence: { transactionIds: [...ids, "tx-0"] } }),
		);
		expect(rec?.evidence.transactionIds).toEqual(ids.slice(0, 20));
	});
});
