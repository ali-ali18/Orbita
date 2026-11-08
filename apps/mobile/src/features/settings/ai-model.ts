import {
	AI_LIMIT_MAX_USD_CENTS,
	type AiSettingsResponse,
	formatUsdCents,
	microUsdToUsdCents,
} from "@orbita/shared";

/*
 * "Servidor e chaves" → IA. O servidor calcula o custo e o bloqueio; aqui só se formata e se lê o limite digitado.
 * Tudo em dólar, que é como a Anthropic cobra, e em centavos inteiros.
 */

export const LIMIT_SHEET_TITLE = "Limite mensal da IA";
export const LIMIT_HINT =
	"Quando o gasto do mês com a IA chega a este valor, o chat para até você aumentar o limite ou o mês virar. Em dólares (US$), que é como a Anthropic cobra.";
export const NO_LIMIT_LABEL = "Sem limite";

export type LimitParse = { ok: true; cents: number } | { ok: false; message: string };

/** "10", "10,5", "US$ 10,50", "10.50" → centavos de dólar. "1.000" é recusado (vírgula ou ponto separa os centavos). */
export function parseUsdInput(text: string): LimitParse {
	const match = /^(?:US\$\s*)?(\d{1,5})(?:[.,](\d{1,2}))?$/.exec(text.trim());
	if (!match) {
		return { ok: false, message: "Digite o limite em dólares, por exemplo 10 ou 12,50." };
	}
	const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
	if (cents > AI_LIMIT_MAX_USD_CENTS) return { ok: false, message: "O limite passa de US$ 10.000." };
	return { ok: true, cents };
}

/** Valor do campo ao abrir a gaveta ("10,00"), sem o "US$". */
export function limitFieldValue(limitUsdCents: number | null): string {
	if (limitUsdCents === null) return "";
	return formatUsdCents(limitUsdCents).replace("US$ ", "");
}

export function limitValueLabel(limitUsdCents: number | null): string {
	return limitUsdCents === null ? NO_LIMIT_LABEL : formatUsdCents(limitUsdCents);
}

/** Gasto do mês em dólar, arredondado para cima (nunca mostra menos do que se gastou). */
export function aiCostLabel(settings: Pick<AiSettingsResponse, "costMicroUsd">): string {
	return formatUsdCents(microUsdToUsdCents(settings.costMicroUsd));
}

export function aiCostCaption(settings: AiSettingsResponse): string {
	const calls = settings.requests === 1 ? "1 chamada" : `${settings.requests} chamadas`;
	if (settings.blocked) return `Limite atingido: o chat está pausado · ${calls}`;
	return calls;
}
