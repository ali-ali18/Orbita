import {
	investmentDetailResponse,
	investmentEvolutionResponse,
	investmentsOverviewResponse,
} from "@orbita/shared";
import { describe, expect, it } from "vitest";
import { setupFinance } from "../../test-support.ts";

// "Hoje" nos testes: 15/11/2026 (ver NOW em test-support). Dados fictícios.
const ITEM = "11111111-1111-4111-8111-111111111111";

async function seeded() {
	const t = await setupFinance();
	await t.stores.pluggyConnections.add({ id: ITEM, label: "Banco A", byOwner: true });
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
	await t.stores.investments.upsertMovements(cdb.id, [
		{ externalId: "m1", type: "BUY", date: "2026-05-10", amountCents: 1000000, description: "Aplicação" },
	]);
	await t.stores.investments.upsertSnapshot(cdb.id, {
		day: "2026-10-31",
		balanceCents: 1010000,
		investedCents: 1000000,
	});
	await t.stores.investments.upsertSnapshot(cdb.id, {
		day: "2026-11-10",
		balanceCents: 1015000,
		investedCents: 1000000,
	});
	return { ...t, cdb };
}

describe("investimentos", () => {
	it("exige o token em todas as rotas", async () => {
		const { call } = await setupFinance();
		for (const path of ["/v1/investments", "/v1/investments/evolution", "/v1/investments/x"]) {
			expect((await call("GET", path, undefined, null)).status).toBe(401);
		}
	});

	it("sem nada sincronizado: resumo vazio no formato do contrato", async () => {
		const { api } = await setupFinance();
		const res = await api.get("/v1/investments");
		expect(res.status).toBe(200);
		expect(investmentsOverviewResponse.parse(res.body)).toEqual(res.body);
		expect(res.body).toMatchObject({ asOf: "2026-11-15", hasData: false, totalCents: 0, positions: [] });
	});

	it("resumo: patrimônio, rendimento do mês e total, grupos e posições no formato do contrato", async () => {
		const { api } = await seeded();
		const res = await api.get("/v1/investments");
		expect(res.status).toBe(200);
		expect(investmentsOverviewResponse.parse(res.body)).toEqual(res.body);
		expect(res.body).toMatchObject({
			hasData: true,
			totalCents: 1020000,
			activePositions: 1,
			yield: {
				total: { cents: 20000, estimated: false, returnBps: 200 },
				month: { month: "2026-11", cents: 10000, baselineDay: "2026-10-31", reason: null },
			},
			byClass: [{ class: "fixed_income", label: "Renda fixa", shareBps: 10000 }],
			byInstitution: [{ key: ITEM, label: "Banco A", shareBps: 10000 }],
		});
		expect(res.body.positions[0]).toMatchObject({
			name: "CDB Fictício",
			subtypeLabel: "CDB",
			balanceCents: 1020000,
		});
	});

	it("detalhe: posição, movimentações e retratos; id inexistente é 404", async () => {
		const { api, cdb } = await seeded();
		const res = await api.get(`/v1/investments/${cdb.id}`);
		expect(res.status).toBe(200);
		expect(investmentDetailResponse.parse(res.body)).toEqual(res.body);
		expect(res.body.movements).toEqual([
			expect.objectContaining({ kind: "contribution", amountCents: 1000000, description: "Aplicação" }),
		]);
		expect(res.body.snapshots.map((s: { day: string }) => s.day)).toEqual(["2026-10-31", "2026-11-10"]);
		const missing = await api.get("/v1/investments/nada");
		expect(missing.status).toBe(404);
		expect(missing.body.error.code).toBe("nao_encontrado");
	});

	it("evolução: padrão 6m, faixas 1m e 1y; faixa inválida é 400; sem dias preenchidos", async () => {
		const { api } = await seeded();
		const def = await api.get("/v1/investments/evolution");
		expect(def.status).toBe(200);
		expect(investmentEvolutionResponse.parse(def.body)).toEqual(def.body);
		expect(def.body).toMatchObject({
			range: "6m",
			from: "2026-05-15",
			to: "2026-11-15",
			coveredFrom: "2026-10-31",
		});
		expect(def.body.points.map((p: { day: string }) => p.day)).toEqual(["2026-10-31", "2026-11-10"]);
		expect((await api.get("/v1/investments/evolution?range=1m")).body.from).toBe("2026-10-15");
		expect((await api.get("/v1/investments/evolution?range=1y")).body.from).toBe("2025-11-15");
		const bad = await api.get("/v1/investments/evolution?range=2y");
		expect(bad.status).toBe(400);
		expect(bad.body.error).toMatchObject({
			code: "dados_invalidos",
			message: "A faixa deve ser 1m, 6m ou 1y.",
		});
	});

	it("evolução sem retratos: lista vazia com o motivo", async () => {
		const { api } = await setupFinance();
		const res = await api.get("/v1/investments/evolution?range=1m");
		expect(res.body).toMatchObject({ points: [], coveredFrom: null, reason: "sem histórico ainda" });
	});
});
