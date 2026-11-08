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

// ------------------------------------------------------------------ modelo

export type ModelOption = AiSettingsResponse["modelOptions"][number];

export const MODEL_SHEET_TITLE = "Modelo do chat";
export const MODEL_HINT =
	"Qual modelo da Anthropic responde no chat. Os mais capazes custam mais por mensagem; o gasto entra no limite mensal.";
export const FAST_MODEL_SHEET_TITLE = "Modelo rápido";
export const FAST_MODEL_HINT =
	"Perguntas curtas, só de consulta, vão neste modelo, que é mais barato. Escrever (lançar, trocar categoria) sempre usa o modelo do chat.";
export const FAST_OFF_ID = "off";
export const FAST_OFF_LABEL = "Desligado";
export const FAST_OFF_DESCRIPTION = "Tudo é respondido pelo modelo do chat.";

/** "Sonnet 5.5"; id que não está na lista (padrão do servidor mais novo) aparece como veio. */
export function modelLabel(options: readonly ModelOption[], id: string | null): string {
	if (id === null) return FAST_OFF_LABEL;
	return options.find((o) => o.id === id)?.label ?? id;
}

/** "US$ 2,00 entrada · US$ 10,00 saída por 1 mi de tokens". `conferir` quando o preço não foi confirmado. */
export function modelPriceLabel(option: ModelOption): string {
	const usd = (micro: number) => formatUsdCents(microUsdToUsdCents(micro));
	const base = `${usd(option.inputMicroUsdPerMTok)} entrada · ${usd(option.outputMicroUsdPerMTok)} saída por 1 mi de tokens`;
	return option.priceToConfirm ? `${base} (preço a conferir)` : base;
}

export interface ModelChoice {
	id: string;
	label: string;
	description: string;
	/** Linha de preço; `null` para "Desligado". */
	price: string | null;
}

export function mainModelChoices(options: readonly ModelOption[]): ModelChoice[] {
	return options
		.filter((o) => o.main)
		.map((o) => ({ id: o.id, label: o.label, description: o.description, price: modelPriceLabel(o) }));
}

export function fastModelChoices(options: readonly ModelOption[]): ModelChoice[] {
	return [
		...options
			.filter((o) => o.fast)
			.map((o) => ({ id: o.id, label: o.label, description: o.description, price: modelPriceLabel(o) })),
		{ id: FAST_OFF_ID, label: FAST_OFF_LABEL, description: FAST_OFF_DESCRIPTION, price: null },
	];
}

/** Valor da linha "Modelo" em Configurações: o nome, e "padrão" quando vem do servidor. */
export function modelRowValue(settings: AiSettingsResponse): string {
	return modelLabel(settings.modelOptions, settings.chatModel);
}

export function fastModelRowValue(settings: AiSettingsResponse): string {
	return modelLabel(settings.modelOptions, settings.chatModelFast);
}

/**
 * Qual opção a gaveta marca: o modelo em vigor, que é o salvo pelo dono ou, sem escolha, o padrão do servidor (o
 * servidor já devolve o resultado em `chatModel`/`chatModelFast`). Rápido desligado (`null`) marca "Desligado".
 */
export function currentChoiceId(
	settings: AiSettingsResponse | undefined,
	which: "main" | "fast",
): string | null {
	if (!settings) return null;
	if (which === "main") return settings.chatModel;
	return settings.chatModelFast ?? FAST_OFF_ID;
}
