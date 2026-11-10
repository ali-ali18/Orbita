import { isLocalDate, MAX_CENTS } from "@orbita/shared";
import { invalid } from "./errors.ts";
import type {
	InvestmentFields,
	InvestmentInput,
	InvestmentMovementInput,
	InvestmentSnapshotInput,
} from "./investment-store.ts";

/** Normalizadores dos investimentos, compartilhados pelo store Prisma e o de memória: mesma regra, mesma mensagem. */

export const DECIMAL_SCALE = 8;

const text = (value: unknown, label: string, max: number): string | null => {
	if (value === undefined || value === null) return null;
	if (typeof value !== "string") throw invalid(`${label} deve ser texto.`);
	const trimmed = value.trim();
	if (trimmed.length === 0) return null;
	if (trimmed.length > max) throw invalid(`${label} passa de ${max} letras.`);
	return trimmed;
};

/** Centavos inteiros, positivos ou negativos (rendimento pode ser perda). `null` fica `null`: ausente nunca vira zero. */
export function signedCents(value: unknown, label: string): number | null {
	if (value === undefined || value === null) return null;
	if (!Number.isSafeInteger(value) || Math.abs(value as number) > MAX_CENTS) {
		throw invalid(`${label} deve ser um inteiro de centavos.`);
	}
	return value as number;
}

/**
 * Decimal em texto canônico: `1.2500` → "1.25", `3.0` → "3", `-0` → "0"; até 8 casas (o que passa é cortado, como a
 * borda já faz) e 20 dígitos antes da vírgula (cabe em NUMERIC(28,8)). Notação científica e lixo são recusados.
 */
export function canonicalDecimal(value: unknown, label: string): string | null {
	if (value === undefined || value === null) return null;
	if (typeof value !== "string" || !/^-?\d{1,20}(\.\d+)?$/.test(value.trim())) {
		throw invalid(`${label} deve ser um número decimal em texto.`);
	}
	const [whole = "0", fraction = ""] = value.trim().split(".");
	const kept = fraction.slice(0, DECIMAL_SCALE).replace(/0+$/, "");
	const sign = whole.startsWith("-") ? "-" : "";
	const digits = whole.replace(/^-/, "").replace(/^0+(?=\d)/, "");
	const out = kept ? `${sign}${digits}.${kept}` : `${sign}${digits}`;
	return /^-0(\.0*)?$/.test(out) ? "0" : out;
}

const day = (value: unknown, label: string): string | null => {
	if (value === undefined || value === null) return null;
	if (!isLocalDate(value)) throw invalid(`${label} é inválida (use AAAA-MM-DD).`);
	return value;
};

export function normalizeInvestment(
	input: InvestmentInput,
): { source: string; externalId: string } & InvestmentFields {
	const source = text(input.source, "A origem", 40);
	const externalId = text(input.externalId, "O id da posição", 200);
	if (source === null || externalId === null) throw invalid("Informe a origem e o id da posição.");
	return {
		source,
		externalId,
		connectionId: text(input.connectionId, "A conexão", 100),
		type: text(input.type, "O tipo", 40),
		subtype: text(input.subtype, "O subtipo", 60),
		name: text(input.name, "O nome", 500),
		code: text(input.code, "O código", 60),
		isin: text(input.isin, "O ISIN", 20),
		currency: text(input.currency, "A moeda", 10),
		status: text(input.status, "A situação", 40),
		balanceCents: signedCents(input.balanceCents, "O saldo"),
		grossCents: signedCents(input.grossCents, "O valor bruto"),
		investedCents: signedCents(input.investedCents, "O valor aplicado"),
		profitCents: signedCents(input.profitCents, "O rendimento"),
		withdrawableCents: signedCents(input.withdrawableCents, "O valor disponível para resgate"),
		incomeTaxCents: signedCents(input.incomeTaxCents, "O imposto de renda"),
		financialTaxCents: signedCents(input.financialTaxCents, "O imposto financeiro"),
		quantity: canonicalDecimal(input.quantity, "A quantidade"),
		unitValue: canonicalDecimal(input.unitValue, "O valor da cota"),
		rate: canonicalDecimal(input.rate, "A taxa"),
		rateType: text(input.rateType, "O tipo de taxa", 20),
		fixedAnnualRate: canonicalDecimal(input.fixedAnnualRate, "A taxa anual fixa"),
		annualRate: canonicalDecimal(input.annualRate, "A taxa anual"),
		lastMonthRate: canonicalDecimal(input.lastMonthRate, "A taxa do último mês"),
		lastTwelveMonthsRate: canonicalDecimal(input.lastTwelveMonthsRate, "A taxa dos últimos 12 meses"),
		positionDate: day(input.positionDate, "A data da posição"),
		dueDate: day(input.dueDate, "A data de vencimento"),
		issueDate: day(input.issueDate, "A data de emissão"),
		purchaseDate: day(input.purchaseDate, "A data de compra"),
		issuer: text(input.issuer, "O emissor", 300),
	};
}

export function normalizeSnapshot(input: InvestmentSnapshotInput) {
	const balanceCents = signedCents(input.balanceCents, "O saldo");
	const snapshotDay = day(input.day, "O dia");
	if (snapshotDay === null) throw invalid("Informe o dia do retrato.");
	return {
		balanceCents,
		day: snapshotDay,
		grossCents: signedCents(input.grossCents, "O valor bruto"),
		investedCents: signedCents(input.investedCents, "O valor aplicado"),
		quantity: canonicalDecimal(input.quantity, "A quantidade"),
		unitValue: canonicalDecimal(input.unitValue, "O valor da cota"),
	};
}

export function normalizeMovement(input: InvestmentMovementInput) {
	const externalId = text(input.externalId, "O id da movimentação", 200);
	if (externalId === null) throw invalid("Informe o id da movimentação.");
	return {
		externalId,
		type: text(input.type, "O tipo", 40),
		movementType: text(input.movementType, "O sentido", 20),
		date: day(input.date, "A data"),
		tradeDate: day(input.tradeDate, "A data da liquidação"),
		amountCents: signedCents(input.amountCents, "O valor"),
		netAmountCents: signedCents(input.netAmountCents, "O valor líquido"),
		quantity: canonicalDecimal(input.quantity, "A quantidade"),
		unitValue: canonicalDecimal(input.unitValue, "O valor da cota"),
		description: text(input.description, "A descrição", 1000),
	};
}

/** A situação que fecha a posição (o banco diz que tudo foi resgatado). */
export const CLOSED_STATUS = "TOTAL_WITHDRAWAL";
