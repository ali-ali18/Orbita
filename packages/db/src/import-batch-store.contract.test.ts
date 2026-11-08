import { beforeEach, describe, expect, it } from "vitest";
import { contractSuites } from "./contract-harness.ts";
import type { Stores } from "./stores.ts";

const T0 = new Date("2026-11-10T12:00:00Z");
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);
const HASH = "a".repeat(64);
const OTHER = "b".repeat(64);

describe.each(contractSuites())("ImportBatchStore (%s)", (_name, make) => {
	let imports: Stores["imports"];
	beforeEach(async () => {
		imports = (await make()).imports;
	});

	const begin = (o: { hash?: string; target?: string; at?: Date; staleAfterMin?: number } = {}) => {
		const now = o.at ?? T0;
		return imports.begin({
			fileHash: o.hash ?? HASH,
			targetKey: o.target ?? "account:a1",
			format: "ofx",
			now,
			staleBefore: new Date(now.getTime() - (o.staleAfterMin ?? 5) * 60_000),
		});
	};
	const summary = { created: 3, duplicates: 1, possibleDuplicates: 2, unrecognized: 4 };

	it("a primeira vez reserva; a segunda vê a reserva em andamento", async () => {
		const first = await begin();
		expect(first.outcome).toBe("started");
		const second = await begin({ at: minutes(1) });
		expect(second.outcome).toBe("existing");
		if (second.outcome === "existing") {
			expect(second.batch).toMatchObject({ fileHash: HASH, targetKey: "account:a1", summary: null });
		}
	});

	it("complete guarda o resultado e ele volta ao repetir o envio", async () => {
		const first = await begin();
		if (first.outcome !== "started") throw new Error("esperava started");
		await imports.complete(first.id, summary);
		const again = await begin({ at: minutes(1) });
		expect(again.outcome === "existing" && again.batch.summary).toEqual(summary);
	});

	it("find só consulta, sem reservar", async () => {
		expect(await imports.find(HASH, "account:a1")).toBeNull();
		expect(await imports.find(HASH, "account:a1")).toBeNull();
		await begin();
		expect(await imports.find(HASH, "account:a1")).toMatchObject({ summary: null });
	});

	it("o mesmo arquivo em outro destino, ou outro arquivo no mesmo destino, é outra importação", async () => {
		await begin();
		expect((await begin({ target: "card:c1" })).outcome).toBe("started");
		expect((await begin({ hash: OTHER })).outcome).toBe("started");
	});

	it("release desfaz a reserva sem resultado, mas não apaga uma concluída", async () => {
		const first = await begin();
		if (first.outcome !== "started") throw new Error("esperava started");
		await imports.release(first.id);
		const retry = await begin({ at: minutes(1) });
		expect(retry.outcome).toBe("started");
		if (retry.outcome !== "started") return;
		await imports.complete(retry.id, summary);
		await imports.release(retry.id);
		expect((await begin({ at: minutes(2) })).outcome).toBe("existing");
	});

	it("reserva sem resultado e velha é retomada", async () => {
		await begin();
		expect((await begin({ at: minutes(4) })).outcome).toBe("existing");
		expect((await begin({ at: minutes(10) })).outcome).toBe("started");
	});
});
