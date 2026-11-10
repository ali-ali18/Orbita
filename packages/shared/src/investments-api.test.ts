import { describe, expect, it } from "vitest";
import { investmentPositionDto, investmentsOverviewResponse } from "./investments-api.ts";

// Resposta de um servidor ANTIGO (sem os campos de taxa e rendimento esperado): o app novo tem de aceitar.
const old = {
	id: "p1",
	name: "CDB Fictício",
	code: null,
	type: "FIXED_INCOME",
	subtype: "CDB",
	subtypeLabel: "CDB",
	class: "fixed_income",
	classLabel: "Renda fixa",
	status: "ACTIVE",
	active: true,
	currency: "BRL",
	institutionKey: "i1",
	institutionLabel: "Banco A",
	balanceCents: 1020000,
	grossCents: null,
	investedCents: 1000000,
	withdrawableCents: null,
	incomeTaxCents: null,
	yield: { cents: 20000, estimated: false, basis: "invested", returnBps: 200, reason: null },
	quantity: null,
	unitValue: null,
	rate: null,
	rateType: null,
	fixedAnnualRate: null,
	positionDate: null,
	dueDate: null,
	issueDate: null,
	purchaseDate: null,
	issuer: null,
	syncedAt: "2026-11-15T15:00:00.000Z",
	archivedAt: null,
};

describe("contrato tolerante a servidor antigo", () => {
	it("a posição sem os campos novos passa no schema e continua sem eles (undefined)", () => {
		const parsed = investmentPositionDto.parse(old);
		expect(parsed.terms).toBeUndefined();
		expect(parsed.missing).toBeUndefined();
		expect(parsed.expected).toBeUndefined();
		expect(parsed.termsApplicable).toBeUndefined();
	});

	it("o resumo sem missingTermsPositions também passa", () => {
		const overview = {
			asOf: "2026-11-15",
			hasData: true,
			syncedAt: null,
			totalCents: 0,
			activePositions: 0,
			withoutBalance: 0,
			foreignCurrency: 0,
			closedPositions: 0,
			yield: {
				total: {
					cents: null,
					estimated: false,
					returnBps: null,
					countedPositions: 0,
					missingPositions: 0,
					reason: null,
				},
				month: {
					month: "2026-11",
					cents: null,
					partial: false,
					countedPositions: 0,
					missingPositions: 0,
					baselineDay: null,
					reason: null,
				},
			},
			byClass: [],
			byInstitution: [],
			positions: [old],
			monthly: [],
		};
		expect(investmentsOverviewResponse.parse(overview).missingTermsPositions).toBeUndefined();
	});
});
