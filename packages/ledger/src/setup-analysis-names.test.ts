import { describe, expect, it } from "vitest";
import { analyzeHistory, type SetupTransaction } from "./setup-analysis.ts";

const TODAY = "2026-11-09";
const BANK = "GOOGLE BRASIL INTERNET LTDA.";

let n = 0;
const tx = (
	date: string,
	amountCents: number,
	description: string,
	merchantName: string | null = BANK,
): SetupTransaction => ({
	id: `t${++n}`,
	kind: "expense",
	date,
	amountCents,
	description,
	merchantName,
	categoryId: "c-out",
	accountId: null,
	cardId: "card-1",
	installment: false,
});

const analyze = (transactions: SetupTransaction[]) =>
	analyzeHistory({
		transactions,
		today: TODAY,
		registeredNames: [],
		hasIncome: true,
		categories: [
			{ id: "c-ass", slug: "assinaturas" },
			{ id: "c-out", slug: "outros" },
		],
		rules: [],
	}).recurring.map((r) => [r.key, r.displayName, r.amountCents, r.occurrences]);

describe("analyzeHistory: nome amigável e apps do Google Play", () => {
	it("o nome do banco (razão social do Google) nunca vira o nome mostrado", () => {
		expect(
			analyze([
				tx("2026-09-10", 3899, "Google Pierre Control"),
				tx("2026-10-10", 3899, "DL*GOOGLE Pierre Cont"),
			]),
		).toEqual([["rec:pierre", "Pierre", 3899, 2]]);
	});

	it("DL*GOOGLE ChatGP em setembro, Google ChatGPT em outubro e DL*GOOGLE ChatGP em novembro: um ChatGPT só", () => {
		expect(
			analyze([
				tx("2026-09-05", 9599, "DL*GOOGLE ChatGP"),
				tx("2026-10-05", 9599, "Google ChatGPT"),
				tx("2026-11-04", 9599, "DL*GOOGLE ChatGP"),
			]),
		).toEqual([["rec:chatgpt", "ChatGPT (Google Play)", 9599, 3]]);
	});

	it("Grok (dia 30) com o banco escrevendo X.AI num mês e SuperGrok no outro", () => {
		expect(
			analyze([
				tx("2026-09-30", 16990, "X.AI LLC", "X.AI LLC"),
				tx("2026-10-30", 16990, "SuperGrok", "SuperGrok"),
			]),
		).toEqual([["rec:grok", "Grok", 16990, 2]]);
	});

	it("YouTube Member (R$ 7,99) e YouTube Premium aparecem separados, ambos chamados YouTube", () => {
		expect(
			analyze([
				tx("2026-09-10", 799, "Google YouTube Member"),
				tx("2026-10-10", 799, "Google YouTube Member"),
				tx("2026-09-12", 2190, "Google YouTube"),
				tx("2026-10-12", 2190, "DL*GOOGLE YouTub"),
			]),
		).toEqual([
			["rec:youtube:2190", "YouTube", 2190, 2],
			["rec:youtube:799", "YouTube", 799, 2],
		]);
	});

	it("sem pista do app, o nome é o estabelecimento limpo, não o texto cru", () => {
		expect(
			analyze([
				tx("2026-08-08", 48000, "UNIP*MENSALIDADE 0423", null),
				tx("2026-09-08", 48000, "UNIP*MENSALIDADE 0423", null),
				tx("2026-10-08", 48000, "UNIP*MENSALIDADE 0423", null),
			]),
		).toEqual([["rec:unip", "Unip Mensalidade", 48000, 3]]);
	});
});
