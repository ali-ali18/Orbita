/** Limite mensal quando o dono nunca mexeu: US$ 10,00 (em centavos de dólar). */
export const DEFAULT_AI_MONTHLY_LIMIT_USD_CENTS = 1000;

export interface AiUsageInput {
	/** `null` para chamadas fora de uma conversa (agentes do worker). */
	conversationId: string | null;
	model: string;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	/** Em micro-dólares (1 US$ = 1.000.000), inteiro, já arredondado para cima. */
	costMicroUsd: number;
	at: Date;
}

export interface AiUsageTotals {
	costMicroUsd: number;
	requests: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
}

/** Modelos escolhidos no app; `null` = não escolheu (vale o padrão do servidor). `chatModelFast` pode ser "off". */
export interface AiModelChoice {
	chatModel: string | null;
	chatModelFast: string | null;
}

/**
 * Quanto a IA custou. O custo vem em micro-dólares inteiros (tabela de preços em `@orbita/agents`); o mês é o do
 * fuso de São Paulo. Apagar uma conversa não apaga o custo.
 */
export interface AiUsageStore {
	/** `invalid` se algum número não for inteiro maior ou igual a zero. */
	record(input: AiUsageInput): Promise<void>;
	/** Soma do mês (AAAA-MM). Mês sem uso devolve tudo zero. */
	monthTotals(month: string): Promise<AiUsageTotals>;
	/** Limite mensal em centavos de dólar; `null` = sem limite. Sem nada gravado, o padrão. */
	getMonthlyLimit(): Promise<number | null>;
	/** `invalid` se não for inteiro entre 0 e 1.000.000. `null` tira o limite. */
	setMonthlyLimit(usdCents: number | null): Promise<number | null>;
	/** O que o dono escolheu; sem nada gravado, tudo `null`. */
	getModelChoice(): Promise<AiModelChoice>;
	/** Campo ausente fica como está; `null` volta ao padrão. `invalid` para texto vazio ou grande demais. A lista permitida é da API. */
	setModelChoice(patch: Partial<AiModelChoice>): Promise<AiModelChoice>;
}
