import { describe, expect, it } from "vitest";
import { formatPluggyDiagnostics, type PluggyDiagnosticsResponse } from "./pluggy-diagnostics.ts";

const sample: PluggyDiagnosticsResponse = {
	generatedAt: "2026-11-15T15:00:00.000Z",
	connections: [
		{
			label: "Meu banco",
			itemIdStart: "123e4567",
			connectorName: "Nubank",
			status: "UPDATED",
			executionStatus: "SUCCESS",
			lastUpdatedAt: null,
			connectorIsOpenFinance: true,
			connectorType: "PERSONAL_BANK",
			nextAutoSyncAt: "2026-11-16T08:00:00.000Z",
			consentExpiresAt: null,
			products: [{ name: "accounts", isUpdated: false, lastUpdatedAt: null, warnings: ["423: limite"] }],
			itemError: null,
			error: null,
			accounts: [
				{
					idStart: "0f1d2c3b",
					type: "CREDIT",
					subtype: "CREDIT_CARD",
					name: "Gold",
					marketingName: null,
					numberLast4: "•••4321",
					balance: 830.1,
					currencyCode: "BRL",
					credit: {
						creditLimit: 5000,
						availableCreditLimit: 4169.9,
						balanceCloseDate: "2026-11-10",
						balanceDueDate: "2026-11-17",
						minimumPayment: null,
						brand: "MASTERCARD",
						level: null,
					},
					link: null,
					bills: { error: { code: "not_found", status: 404, message: "não achou" }, list: [] },
					transactions: {
						error: null,
						windowDays: 45,
						posted: 2,
						pending: 1,
						other: 0,
						dropped: 0,
						pendingTotal: "R$ 99,90",
						recent: [
							{
								date: "2026-11-10",
								description: "Loja X",
								amount: 99.9,
								type: "DEBIT",
								status: "PENDING",
								category: null,
								installmentNumber: 3,
								totalInstallments: 10,
								purchaseDate: "2026-09-10",
								merchantName: null,
								operationType: "PIX",
								providerIdStart: "abcd1234",
								billIdStart: "bill0001",
								billPostDate: "2026-12-10",
								billForecastDate: null,
								paymentType: null,
								payer: null,
								receiver: { name: "MARIA", documentEnd: "•••195" },
							},
						],
					},
				},
			],
		},
	],
};

describe("formatPluggyDiagnostics", () => {
	it("gera o texto para copiar, com erro de faturas e parcela", () => {
		const text = formatPluggyDiagnostics(sample);
		expect(text).toContain("Conexão Meu banco");
		expect(text).toContain("Ligada no Órbita a: não ligada");
		expect(text).toContain("Faturas: ERRO not_found (HTTP 404)");
		expect(text).toContain("2 POSTED · 1 PENDING");
		expect(text).toContain("parcela 3/10 compra 2026-09-10");
		expect(text).toContain("total PENDING R$ 99,90");
		expect(text).toContain("Open Finance true · tipo PERSONAL_BANK");
		expect(text).toContain("produto accounts: atualizado false");
		expect(text).toContain("providerId abcd1234… · fatura bill0001… · lançada na fatura em 2026-12-10");
		expect(text).toContain("recebedor: MARIA doc •••195");
	});

	it("sem conexões", () => {
		expect(formatPluggyDiagnostics({ generatedAt: "x", connections: [] })).toContain("Nenhuma conexão");
	});
});
