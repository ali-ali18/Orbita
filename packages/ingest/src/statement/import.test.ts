import { createMemoryStores, type Stores } from "@orbita/db";
import { beforeEach, describe, expect, it } from "vitest";
import { type ImportDeps, importStatement, previewStatement } from "./import.ts";

const enc = (text: string) => new TextEncoder().encode(text);
const NOW = new Date("2026-11-10T15:00:00Z");

const OFX = (rows: string[]) =>
	`<OFX><BANKTRANLIST>${rows.map((r) => `<STMTTRN>${r}</STMTTRN>`).join("\n")}</BANKTRANLIST></OFX>`;
const trn = (date: string, amount: string, fitid: string, memo: string) =>
	`<DTPOSTED>${date}<TRNAMT>${amount}<FITID>${fitid}<MEMO>${memo}`;

describe("importação de extrato", () => {
	let stores: Stores;
	let deps: ImportDeps;
	let accountId: string;
	let cardId: string;

	beforeEach(async () => {
		stores = createMemoryStores();
		deps = { stores, now: () => NOW };
		accountId = (await stores.accounts.create({ name: "Conta", kind: "checking" })).id;
		cardId = (await stores.cards.create({ name: "Cartão", closingDay: 10, dueDay: 17 })).id;
	});

	const file = enc(
		OFX([
			trn("20261102", "-45.90", "F1", "MERCADO TESTE"),
			trn("20261103", "3500.00", "F2", "SALARIO"),
			trn("20261105", "-10.00", "F3", "PADARIA"),
		]),
	);

	it("preview não grava nada e resume período, entradas e saídas", async () => {
		const p = await previewStatement(deps, { bytes: file, filename: "x.ofx", target: { accountId } });
		if (p.status !== "ok") throw new Error("esperava ok");
		expect(p).toMatchObject({
			format: "ofx",
			total: 3,
			toCreate: 3,
			duplicates: 0,
			inCents: 350000,
			outCents: 5590,
			period: { from: "2026-11-02", to: "2026-11-05" },
		});
		expect(await stores.transactions.listPending()).toEqual([]);
	});

	it("importa como pendente com origem 'import' e aplica as regras aprendidas", async () => {
		const category = await stores.categories.create({ slug: "mercado", name: "Mercado", chartSlot: 0 });
		await stores.categoryRules.upsert("mercado teste", category.id);
		const r = await importStatement(deps, { bytes: file, filename: "x.ofx", target: { accountId } });
		expect(r).toMatchObject({ status: "imported", summary: { created: 3, duplicates: 0, unrecognized: 0 } });
		const pending = await stores.transactions.listPending();
		expect(pending).toHaveLength(3);
		expect(
			pending.every((t) => t.source === "import" && t.status === "pending" && t.accountId === accountId),
		).toBe(true);
		const salary = pending.find((t) => t.description === "SALARIO");
		expect(salary).toMatchObject({ kind: "income", amountCents: 350000 });
		expect(pending.find((t) => t.description === "MERCADO TESTE")).toMatchObject({
			kind: "expense",
			amountCents: 4590,
			categoryId: category.id,
		});
	});

	it("o mesmo arquivo de novo não duplica e devolve o resumo anterior", async () => {
		await importStatement(deps, { bytes: file, filename: "x.ofx", target: { accountId } });
		const again = await importStatement(deps, { bytes: file, filename: "x.ofx", target: { accountId } });
		expect(again).toMatchObject({ status: "already_imported", summary: { created: 3 } });
		expect(await stores.transactions.listPending()).toHaveLength(3);
		const p = await previewStatement(deps, { bytes: file, filename: "x.ofx", target: { accountId } });
		expect(p.status === "ok" && p.alreadyImported?.created).toBe(3);
	});

	it("outro arquivo com os mesmos FITIDs: os repetidos são ignorados", async () => {
		await importStatement(deps, { bytes: file, filename: "x.ofx", target: { accountId } });
		const bigger = enc(
			OFX([trn("20261102", "-45.90", "F1", "MERCADO TESTE"), trn("20261106", "-7.00", "F4", "CAFE")]),
		);
		const r = await importStatement(deps, { bytes: bigger, filename: "y.ofx", target: { accountId } });
		expect(r).toMatchObject({ status: "imported", summary: { created: 1, duplicates: 1 } });
	});

	it("o mesmo FITID em outra conta não conta como repetido", async () => {
		const other = (await stores.accounts.create({ name: "Outra", kind: "checking" })).id;
		await importStatement(deps, { bytes: file, filename: "x.ofx", target: { accountId } });
		const r = await importStatement(deps, { bytes: file, filename: "x.ofx", target: { accountId: other } });
		expect(r).toMatchObject({ status: "imported", summary: { created: 3 } });
	});

	it("lançamento que o dono apagou não volta", async () => {
		await importStatement(deps, { bytes: file, filename: "x.ofx", target: { accountId } });
		const [first] = await stores.transactions.listPending();
		await stores.transactions.softDelete(first?.id ?? "");
		const bigger = enc(
			OFX([
				trn("20261102", "-45.90", "F1", "MERCADO TESTE"),
				trn("20261103", "3500.00", "F2", "SALARIO"),
				trn("20261105", "-10.00", "F3", "PADARIA"),
				trn("20261107", "-1.00", "F9", "X"),
			]),
		);
		const r = await importStatement(deps, { bytes: bigger, filename: "z.ofx", target: { accountId } });
		expect(r).toMatchObject({ summary: { created: 1, duplicates: 3 } });
	});

	it("possível duplicata (mesma data e valor, outra origem) é sinalizada e só entra se o dono pedir", async () => {
		await stores.transactions.create({
			kind: "expense",
			amountCents: 4590,
			date: "2026-11-02",
			description: "Mercado (manual)",
			accountId,
		});
		const p = await previewStatement(deps, { bytes: file, filename: "x.ofx", target: { accountId } });
		expect(p.status === "ok" && [p.possibleDuplicates, p.toCreate]).toEqual([1, 2]);
		expect(p.status === "ok" && p.items[0]?.status).toBe("possible_duplicate");

		const skip = await importStatement(deps, { bytes: file, filename: "x.ofx", target: { accountId } });
		expect(skip).toMatchObject({ summary: { created: 2, possibleDuplicates: 1 } });
	});

	it("com includePossibleDuplicates cria também as possíveis duplicatas", async () => {
		await stores.transactions.create({
			kind: "expense",
			amountCents: 4590,
			date: "2026-11-02",
			description: "Mercado (manual)",
			accountId,
		});
		const r = await importStatement(deps, {
			bytes: file,
			filename: "x.ofx",
			target: { accountId },
			includePossibleDuplicates: true,
		});
		expect(r).toMatchObject({ summary: { created: 3 } });
	});

	it("cartão: compra cai na fatura certa e entradas não são importadas", async () => {
		const csv = enc(
			[
				"date,category,title,amount",
				"2026-11-02,x,Padaria,18.50",
				"2026-11-15,x,Uber,23.90",
				"2026-11-03,,Pagamento recebido,-500.00",
			].join("\n"),
		);
		const r = await importStatement(deps, { bytes: csv, filename: "fatura.csv", target: { cardId } });
		expect(r).toMatchObject({ status: "imported", summary: { created: 2, creditsSkipped: 1 } });
		const rows = await stores.transactions.listPending();
		const byDesc = Object.fromEntries(rows.map((t) => [t.description, t]));
		expect(byDesc.Padaria).toMatchObject({
			cardId,
			kind: "expense",
			amountCents: 1850,
			invoiceMonth: "2026-11",
		});
		expect(byDesc.Uber).toMatchObject({ invoiceMonth: "2026-12" });
	});

	it("CSV ambíguo devolve o pedido de mapeamento, sem gravar", async () => {
		const r = await importStatement(deps, {
			bytes: enc("05/03/2026;MERCADO;-45,90\n"),
			filename: "a.csv",
			target: { accountId },
		});
		expect(r.status).toBe("needs_mapping");
		expect(await stores.transactions.listPending()).toEqual([]);
	});

	it("falha no meio libera a reserva e o envio pode ser repetido", async () => {
		const broken = {
			...stores.transactions,
			upsertByExternal: async () => {
				throw new Error("boom");
			},
		};
		const bad: ImportDeps = { ...deps, stores: { ...stores, transactions: broken } };
		await expect(
			importStatement(bad, { bytes: file, filename: "x.ofx", target: { accountId } }),
		).rejects.toThrow("boom");
		const r = await importStatement(deps, { bytes: file, filename: "x.ofx", target: { accountId } });
		expect(r).toMatchObject({ status: "imported", summary: { created: 3 } });
	});

	it("destino inexistente ou arquivado é recusado", async () => {
		await expect(
			importStatement(deps, { bytes: file, filename: "x.ofx", target: { accountId: "nope" } }),
		).rejects.toMatchObject({ code: "bad_reference" });
		await stores.accounts.archive(accountId);
		await expect(
			importStatement(deps, { bytes: file, filename: "x.ofx", target: { accountId } }),
		).rejects.toMatchObject({ code: "bad_reference" });
	});

	it("linhas não entendidas entram na contagem", async () => {
		const bad = enc(OFX([trn("20261102", "-45.90", "F1", "OK"), trn("xx", "-1.00", "F2", "RUIM")]));
		const r = await importStatement(deps, { bytes: bad, filename: "x.ofx", target: { accountId } });
		expect(r).toMatchObject({ summary: { created: 1, unrecognized: 1 } });
	});
});
