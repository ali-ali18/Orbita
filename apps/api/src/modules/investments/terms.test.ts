import { investmentTermsResponse } from "@orbita/shared";
import { describe, expect, it } from "vitest";
import { setupFinance } from "../../test-support.ts";

// "Hoje" nos testes: 15/11/2026 (ver NOW em test-support). Dados fictícios.
const ITEM = "11111111-1111-4111-8111-111111111111";
const path = (id: string) => `/v1/investments/${id}/terms`;
const valid = { rateKind: "CDI_PERCENT", rateBps: 10200, investedCents: 1000000, startDate: "2026-11-02" };

async function seeded() {
	const t = await setupFinance();
	await t.stores.pluggyConnections.add({ id: ITEM, label: "Banco A", byOwner: true });
	// O banco informou o valor aplicado, mas não a taxa nem a data.
	const cdb = (
		await t.stores.investments.upsertPosition({
			source: "pluggy",
			externalId: "cdb",
			connectionId: ITEM,
			type: "FIXED_INCOME",
			subtype: "CDB",
			name: "CDB Fictício",
			status: "ACTIVE",
			currency: "BRL",
			balanceCents: 1020000,
			investedCents: 1000000,
		})
	).record;
	await t.stores.cdiRates.upsertMany(
		["02", "03", "04", "05", "06", "09", "10", "11", "12", "13"].map((d) => ({
			day: `2026-11-${d}`,
			rateE8: 55131,
		})),
	);
	return { ...t, cdb };
}

describe("condições do investimento (PUT /v1/investments/:id/terms)", () => {
	it("exige o token e não aceita token desconhecido", async () => {
		const { call, cdb } = await seeded();
		expect((await call("PUT", path(cdb.id), valid, null)).status).toBe(401);
		expect((await call("PUT", path(cdb.id), valid, "token-que-nao-existe")).status).toBe(401);
	});

	it("grava, devolve a posição com terms, expected e gap, e o GET passa a mostrar o mesmo", async () => {
		const { api, cdb } = await seeded();
		const before = await api.get("/v1/investments");
		expect(before.body.positions[0]).toMatchObject({ missing: ["rate", "startDate"], expected: null });
		expect(before.body.missingTermsPositions).toBe(1);

		const res = await api.put(path(cdb.id), valid);
		expect(res.status).toBe(200);
		expect(investmentTermsResponse.parse(res.body)).toEqual(res.body);
		const pos = res.body.position;
		expect(pos.terms).toEqual({
			rate: { kind: "CDI_PERCENT", bps: 10200, source: "USER" },
			// O dono vence; o valor do banco vem ao lado em `bank`.
			invested: { cents: 1000000, source: "USER" },
			startDate: { date: "2026-11-02", source: "USER" },
			bank: { rate: null, invested: 1000000, startDate: null },
		});
		expect(pos.missing).toEqual([]);
		expect(pos.expected.grossCents).toBeGreaterThan(1000000);
		expect(pos.gapCents).toBe(pos.balanceCents - pos.expected.grossCents);

		const after = await api.get("/v1/investments");
		expect(after.body.missingTermsPositions).toBe(0);
		expect(after.body.positions[0].expected).toEqual(pos.expected);
		expect((await api.get(`/v1/investments/${cdb.id}`)).body.position.terms).toEqual(pos.terms);
	});

	it("PUT substitui: sem os campos, o que o dono informou some; vazio limpa", async () => {
		const { api, cdb } = await seeded();
		await api.put(path(cdb.id), valid);
		const res = await api.put(path(cdb.id), { rateKind: "PREFIXED", rateBps: 1350 });
		expect(res.body.position.terms.rate).toEqual({ kind: "PREFIXED", bps: 1350, source: "USER" });
		expect(res.body.position.terms.startDate).toBeNull();
		const cleared = await api.put(path(cdb.id), {});
		expect(cleared.status).toBe(200);
		expect(cleared.body.position.terms.rate).toBeNull();
		expect(cleared.body.position.expected).toBeNull();
	});

	it("investimento inexistente: 404; encerrado: 409 e nada é gravado", async () => {
		const { api, stores } = await seeded();
		const missing = await api.put(path("nada"), valid);
		expect(missing.status).toBe(404);
		expect(missing.body.error.code).toBe("nao_encontrado");
		const closed = (
			await stores.investments.upsertPosition({
				source: "pluggy",
				externalId: "velho",
				type: "FIXED_INCOME",
				subtype: "LCI",
				status: "TOTAL_WITHDRAWAL",
			})
		).record;
		const res = await api.put(path(closed.id), valid);
		expect(res.status).toBe(409);
		expect(res.body.error.code).toBe("investimento_encerrado");
		expect(await stores.investmentTerms.get(closed.id)).toBeNull();
	});

	it("posição que não é renda fixa em reais: 409 com mensagem em pt-BR e nada gravado", async () => {
		const { api, stores } = await seeded();
		const mk = async (externalId: string, extra: Record<string, unknown>) =>
			(
				await stores.investments.upsertPosition({
					source: "pluggy",
					externalId,
					status: "ACTIVE",
					balanceCents: 100000,
					...extra,
				})
			).record;
		const acao = await mk("acao", { type: "EQUITY", subtype: "STOCK", name: "EXEM3", currency: "BRL" });
		const fundo = await mk("fundo", { type: "MUTUAL_FUND", name: "Fundo X", currency: "BRL" });
		const dolar = await mk("usd", { type: "FIXED_INCOME", subtype: "CDB", name: "CDB USD", currency: "USD" });
		for (const p of [acao, fundo, dolar]) {
			const res = await api.put(path(p.id), valid);
			expect(res.status).toBe(409);
			expect(res.body.error).toEqual({
				code: "investimento_sem_taxa",
				message: "Só investimentos de renda fixa em reais aceitam taxa, valor aplicado e data da aplicação.",
			});
			expect(await stores.investmentTerms.get(p.id)).toBeNull();
		}
	});

	it.each([
		[
			"% do CDI acima de 1000%",
			{ rateKind: "CDI_PERCENT", rateBps: 100001 },
			"A taxa em % do CDI deve ficar entre 0,01% e 1000%.",
		],
		[
			"prefixado acima de 100% a.a.",
			{ rateKind: "PREFIXED", rateBps: 10001 },
			"A taxa prefixada deve ficar entre 0,01% e 100% ao ano.",
		],
		[
			"IPCA+ negativo",
			{ rateKind: "IPCA_PLUS", rateBps: -1 },
			"A taxa do IPCA + deve ficar entre 0% e 100% ao ano.",
		],
		["tipo sem taxa", { rateKind: "CDI_PERCENT" }, "Informe o tipo da taxa e o valor dela juntos."],
		["taxa sem tipo", { rateBps: 10000 }, "Informe o tipo da taxa e o valor dela juntos."],
		[
			"taxa decimal",
			{ rateKind: "PREFIXED", rateBps: 13.5 },
			"A taxa deve ser um inteiro em centésimos de ponto percentual.",
		],
		[
			"tipo desconhecido",
			{ rateKind: "SELIC", rateBps: 100 },
			"O tipo de taxa deve ser CDI_PERCENT, PREFIXED ou IPCA_PLUS.",
		],
		["data futura", { startDate: "2026-11-16" }, "A data da aplicação não pode ser futura."],
		["data inexistente", { startDate: "2026-02-30" }, "Data inválida (use AAAA-MM-DD, de 1900 a 2199)."],
		["data antiga demais", { startDate: "1990-01-01" }, "A data da aplicação é antiga demais."],
		["valor zero", { investedCents: 0 }, "O valor aplicado deve ser maior que zero."],
		["valor decimal", { investedCents: 10.5 }, "O valor aplicado deve ser inteiro, em centavos."],
		["valor enorme", { investedCents: 2147483648 }, "O valor aplicado passa do limite aceito."],
	])("recusa com mensagem em pt-BR: %s", async (_label, body, message) => {
		const { api, cdb, stores } = await seeded();
		const res = await api.put(path(cdb.id), body);
		expect(res.status).toBe(400);
		expect(res.body.error).toEqual({ code: "dados_invalidos", message });
		expect(await stores.investmentTerms.get(cdb.id)).toBeNull();
	});

	it("aceita os limites exatos e a data de hoje", async () => {
		const { api, cdb } = await seeded();
		const ok = (body: object) => api.put(path(cdb.id), body).then((r) => r.status);
		expect(await ok({ rateKind: "CDI_PERCENT", rateBps: 100000, startDate: "2026-11-15" })).toBe(200);
		expect(await ok({ rateKind: "PREFIXED", rateBps: 10000 })).toBe(200);
		expect(await ok({ rateKind: "IPCA_PLUS", rateBps: 0 })).toBe(200);
	});

	it("corpo que não é objeto, campo desconhecido e JSON quebrado são 400", async () => {
		const { api, call, cdb } = await seeded();
		expect((await api.put(path(cdb.id), null)).status).toBe(400);
		expect((await api.put(path(cdb.id), [1])).status).toBe(400);
		expect((await api.put(path(cdb.id), { rateKind: "PREFIXED", rateBps: 100, extra: 1 })).status).toBe(400);
		expect((await call("PUT", path(cdb.id), "{nao e json")).status).toBe(400);
	});

	it("sugestão pelo nome vem no GET mas só vale depois de o dono confirmar", async () => {
		const { api, stores } = await seeded();
		const p = (
			await stores.investments.upsertPosition({
				source: "pluggy",
				externalId: "lci",
				type: "FIXED_INCOME",
				subtype: "LCI",
				name: "LCI 95% CDI",
				status: "ACTIVE",
				currency: "BRL",
				balanceCents: 500000,
			})
		).record;
		const got = (await api.get(`/v1/investments/${p.id}`)).body.position;
		expect(got.nameHint).toEqual({ kind: "CDI_PERCENT", bps: 9500, matched: "95% CDI", source: "NAME_HINT" });
		expect(got.terms.rate).toBeNull();
		const res = await api.put(path(p.id), { rateKind: "CDI_PERCENT", rateBps: 9500 });
		expect(res.body.position.terms.rate.source).toBe("USER");
		expect(res.body.position.nameHint).toBeNull();
	});
});
