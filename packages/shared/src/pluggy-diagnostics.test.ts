import { describe, expect, it } from "vitest";
import {
	type DiagInvestment,
	type DiagInvestments,
	formatDiagInvestments,
	formatPluggyDiagnostics,
	type PluggyDiagnosticsResponse,
} from "./pluggy-diagnostics.ts";

// Dados fictícios.
const position: DiagInvestment = {
	idStart: "1a2b3c4d",
	type: "FIXED_INCOME",
	subtype: "CDB",
	name: "CDB Banco Fictício 110% CDI",
	code: null,
	isin: null,
	currencyCode: "BRL",
	balance: 10432.57,
	amount: 10580.1,
	amountOriginal: 10000,
	amountProfit: 432.57,
	amountWithdrawal: 10432.57,
	taxes: 147.53,
	taxes2: 0,
	quantity: null,
	value: null,
	rate: 110,
	rateType: "CDI",
	fixedAnnualRate: null,
	annualRate: null,
	lastMonthRate: null,
	lastTwelveMonthsRate: null,
	date: "2026-11-06",
	dueDate: "2028-05-10",
	issueDate: "2026-05-10",
	purchaseDate: null,
	status: "ACTIVE",
	issuer: "BANCO FICTICIO S/A",
	institutionName: null,
	otherFields: ["number", "owner"],
	transactions: {
		outcome: "ok",
		error: null,
		count: 2,
		dropped: 0,
		firstDate: "2026-05-10",
		lastDate: "2026-08-10",
		byType: [
			{ type: "BUY", count: 1 },
			{ type: "INTEREST", count: 1 },
		],
		recent: [
			{
				date: "2026-08-10",
				type: "INTEREST",
				movementType: "DEBIT",
				amount: 12.5,
				quantity: null,
				value: null,
				description: "Juros",
			},
		],
	},
};

const investments = (extra: Partial<DiagInvestments> = {}): DiagInvestments => ({
	outcome: "ok",
	error: null,
	count: 1,
	dropped: 0,
	balanceTotal: "R$ 10.432,57",
	productRequested: true,
	transactionsProductRequested: true,
	consentExpired: false,
	warnings: [],
	positions: [position],
	transactionsCount: 2,
	transactionsFirstDate: "2026-05-10",
	transactionsLastDate: "2026-08-10",
	...extra,
});
const none: Partial<DiagInvestments> = { count: 0, balanceTotal: null, positions: [], transactionsCount: 0 };

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
			investments: investments(),
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

	it("inclui a seção Investimentos de cada conexão no texto para copiar", () => {
		const text = formatPluggyDiagnostics(sample);
		expect(text).toContain("-- Investimentos · Meu banco");
		expect(text).toContain("Endpoint /investments: respondeu · 1 posição");
		expect(text).toContain("• FIXED_INCOME/CDB · CDB Banco Fictício 110% CDI (1a2b3c4d…)");
		expect(text).toContain("saldo 10432.57 · bruto 10580.1 · aplicado 10000 · rendimento 432.57 · BRL");
		expect(text).toContain("quantidade — · cota/preço — · taxa 110 CDI · fixa a.a. —");
		expect(text).toContain("vencimento 2028-05-10 · data da posição 2026-11-06 · status ACTIVE");
		expect(text).toContain("outros campos preenchidos: number, owner");
		expect(text).toContain("movimentações: 2 · de 2026-05-10 a 2026-08-10 · 1 BUY · 1 INTEREST");
		expect(text).toContain("2026-08-10 · INTEREST/DEBIT · 12.5 · Juros");
		expect(text).toContain("Soma dos saldos (BRL): R$ 10.432,57");
	});

	it("sem posições: diz o motivo observado", () => {
		expect(formatDiagInvestments(investments({ ...none, outcome: "empty" }))).toContain(
			"Motivo observado: endpoint vazio: respondeu sem nenhuma posição",
		);
		const hinted = formatDiagInvestments(
			investments({
				...none,
				outcome: "empty",
				productRequested: false,
				consentExpired: true,
				warnings: ["investments 001: sem permissão"],
			}),
		);
		expect(hinted).toContain("a autorização do item venceu");
		expect(hinted).toContain("INVESTMENTS não está nos produtos do item");
		expect(hinted).toContain("avisos do item: investments 001: sem permissão");
		const refused = formatDiagInvestments(
			investments({
				...none,
				outcome: "unavailable",
				error: {
					code: "forbidden",
					status: 403,
					message: "O Pluggy não entrega investimentos para esta conexão.",
				},
			}),
		);
		expect(refused).toContain("Endpoint /investments: recusou · 0 posições");
		expect(refused).toContain("produto não suportado pelo conector: o endpoint recusou (HTTP 403)");
		const failed = formatDiagInvestments(
			investments({
				...none,
				outcome: "error",
				error: { code: "timeout", status: null, message: "O Pluggy demorou demais para responder." },
			}),
		);
		expect(failed).toContain("erro ao consultar: ERRO timeout: O Pluggy demorou demais para responder.");
	});

	it("servidor antigo (sem a seção) e movimentações recusadas não quebram o texto", () => {
		expect(formatDiagInvestments(undefined)).toContain("Não consultado");
		const text = formatDiagInvestments(
			investments({
				positions: [
					{
						...position,
						transactions: {
							outcome: "unavailable",
							error: { code: "forbidden", status: 403, message: "x" },
							count: 0,
							dropped: 0,
							firstDate: null,
							lastDate: null,
							byType: [],
							recent: [],
						},
					},
				],
			}),
		);
		expect(text).toContain("movimentações: não disponíveis · ERRO forbidden (HTTP 403): x");
	});

	it("sem conexões", () => {
		expect(formatPluggyDiagnostics({ generatedAt: "x", connections: [] })).toContain("Nenhuma conexão");
	});
});
