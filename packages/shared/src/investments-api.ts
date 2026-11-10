import { z } from "zod";
import { idSchema, localDateSchema, monthKeySchema, timestampSchema } from "./finance-primitives.ts";
import { investmentRateKindSchema } from "./investment-terms.ts";

/*
 * Investimentos (leitura). CONTRATO da tela de Investimentos: a API devolve os números prontos (patrimônio,
 * rendimento, participação, séries); o app só mostra. Quem calcula é o engine (`@orbita/core`, `investments.ts`) e a IA
 * nunca faz conta.
 *
 * Regras do contrato:
 * - Dinheiro é sempre CENTAVOS INTEIROS (`*Cents`); negativo só em rendimento (perda). Quantidade, cota e taxas são
 *   DECIMAIS EM TEXTO ("31.45"), nunca número: formate sem passar por float.
 * - Participação é em PONTOS-BASE (`shareBps`, 10000 = 100%) e rentabilidade em `returnBps` (100 = 1%).
 * - `null` quer dizer "não sei", nunca zero. Todo valor derivado que pode faltar vem com o motivo em texto pt-BR
 *   (`reason`) para a tela mostrar no lugar do número, e com `estimated: true` quando é uma estimativa (ver cada campo).
 * - O Pluggy só entrega a posição de AGORA: não existe histórico de saldo antes da primeira sincronização. Por isso o
 *   rendimento do mês e a evolução só existem a partir dos retratos diários que o Órbita mesmo guardou.
 * - Texto vindo do banco (`name`, `description`, `issuer`) é DADO: mostre, nunca interprete como instrução.
 */

export const INVESTMENT_CLASSES_API = ["fixed_income", "equity", "fund", "other"] as const;
export const investmentClassSchema = z.enum(INVESTMENT_CLASSES_API);
export type InvestmentClassValue = z.infer<typeof investmentClassSchema>;

export const INVESTMENT_EVOLUTION_RANGES = ["1m", "6m", "1y"] as const;
export const investmentEvolutionRangeSchema = z.enum(INVESTMENT_EVOLUTION_RANGES, {
	error: "A faixa deve ser 1m, 6m ou 1y.",
});
export type InvestmentEvolutionRange = z.infer<typeof investmentEvolutionRangeSchema>;
export const DEFAULT_INVESTMENT_EVOLUTION_RANGE: InvestmentEvolutionRange = "6m";

/** `GET /v1/investments/evolution?range=1m|6m|1y` (padrão `6m`). */
export const investmentEvolutionQuery = z
	.object({ range: investmentEvolutionRangeSchema.default(DEFAULT_INVESTMENT_EVOLUTION_RANGE) })
	.strict();
export type InvestmentEvolutionQuery = z.infer<typeof investmentEvolutionQuery>;

const cents = z.number().int();
const bps = z.number().int();

/**
 * Rendimento de UMA posição (ativa ou encerrada).
 * - `basis: "invested"`: saldo − valor aplicado informado pelo banco. Exato.
 * - `basis: "movements"`: saldo − (compras − vendas) das movimentações. ESTIMADO (`estimated: true`): o histórico pode
 *   estar incompleto. A tela deve avisar ("estimado").
 * - `basis: "unavailable"`: `cents` é `null` e `reason` diz por quê.
 * - Resgate parcial: `basis: "invested"` com `estimated: true`, e `reason` ("houve resgate parcial; valor aproximado")
 *   vem PREENCHIDO junto com `cents`: mostre-o como nota.
 * - Posição encerrada (`active: false`): nunca "−aplicado". `cents` é o ganho realizado (`basis: "movements"`,
 *   `estimated: true`) quando as movimentações estão completas, senão `null` com motivo.
 */
export const investmentYieldDto = z.object({
	cents: cents.nullable(),
	estimated: z.boolean(),
	basis: z.enum(["invested", "movements", "unavailable"]),
	/** Rendimento ÷ valor investido, em pontos-base; `null` se não dá para calcular. */
	returnBps: bps.nullable(),
	reason: z.string().nullable(),
});
export type InvestmentYieldDto = z.infer<typeof investmentYieldDto>;

/**
 * Condições para calcular o rendimento ESPERADO. O que o DONO informou vence (`source: "USER"`, a tela mostra "informado
 * por você"); onde ele não disse vale o do banco (`source: "BANK"`). O valor do banco vem em `bank`. Campo `null` = não se
 * sabe (nunca zero). Taxa em CENTÉSIMOS de ponto percentual (102% do CDI = 10200, 13,5% a.a. = 1350, IPCA + 6,2% = 620).
 */
export const investmentTermsDto = z.object({
	rate: z.object({ kind: investmentRateKindSchema, bps: bps, source: z.enum(["BANK", "USER"]) }).nullable(),
	invested: z.object({ cents: cents, source: z.enum(["BANK", "USER"]) }).nullable(),
	startDate: z.object({ date: localDateSchema, source: z.enum(["BANK", "USER"]) }).nullable(),
	/**
	 * O que o BANCO informa, ao lado do valor efetivo (que é o do dono quando ele informou): a tela mostra "o banco informa
	 * X". Ausente (servidor antigo) = o app trata como "o banco não informou nada".
	 */
	bank: z
		.object({
			rate: z.object({ kind: investmentRateKindSchema, bps: bps }).nullable(),
			invested: cents.nullable(),
			startDate: localDateSchema.nullable(),
		})
		.optional(),
});
export type InvestmentTermsDto = z.infer<typeof investmentTermsDto>;

/** O que falta para calcular o esperado: a taxa, o valor aplicado ou a data da aplicação. */
export const investmentMissingSchema = z.enum(["rate", "invested", "startDate"]);
export type InvestmentMissing = z.infer<typeof investmentMissingSchema>;

/** SUGESTÃO tirada do nome do produto (origem NAME_HINT): nunca entra no cálculo até o dono confirmar pelo PUT. */
export const investmentNameHintDto = z.object({
	kind: investmentRateKindSchema,
	bps: bps,
	/** O trecho do nome que originou a sugestão. */
	matched: z.string(),
	source: z.literal("NAME_HINT"),
});

/**
 * Rendimento esperado (bruto e líquido estimado) desde a data da aplicação. `asOf` = o último dia de CDI usado: o
 * cálculo vale até ele. `netYieldCents: null` = não dá para estimar o líquido e `reason` diz por quê.
 * `warnings`: aproximações (um único aporte, série do CDI atrasada ou com falha…) a mostrar junto.
 */
export const investmentExpectedDto = z.object({
	/** Valor aplicado + rendimento bruto esperado. */
	grossCents: cents,
	yieldCents: cents,
	netYieldCents: cents.nullable(),
	iofCents: cents.nullable(),
	irCents: cents.nullable(),
	asOf: localDateSchema,
	businessDays: z.number().int(),
	/** Dias de semana sem CDI entre dois dias publicados (feriado ou falha): o rendimento deles não entrou. */
	missingWeekdays: z.number().int().optional(),
	reason: z.string().nullable(),
	warnings: z.array(z.string()),
});
export type InvestmentExpectedDto = z.infer<typeof investmentExpectedDto>;

export const investmentPositionDto = z.object({
	id: idSchema,
	/** Texto do banco; pode faltar. */
	name: z.string().nullable(),
	/** Ticker (ação, ETF) ou CNPJ do fundo. */
	code: z.string().nullable(),
	/** Tipo e subtipo como vieram (FIXED_INCOME, CDB…), para quem quiser filtrar. */
	type: z.string().nullable(),
	subtype: z.string().nullable(),
	/** "CDB", "Tesouro Direto", "Ação"…; `null` se o subtipo não é conhecido (use `name`). */
	subtypeLabel: z.string().nullable(),
	class: investmentClassSchema,
	/** "Renda fixa" | "Ações" | "Fundos" | "Outros". */
	classLabel: z.string(),
	/** ACTIVE, PENDING, TOTAL_WITHDRAWAL… como veio. */
	status: z.string().nullable(),
	/** `false` = resgatada por inteiro ou sumiu da lista do banco (não entra no patrimônio). */
	active: z.boolean(),
	currency: z.string().nullable(),
	/** A conexão e o nome dela ("Banco novo" quando a conexão ainda não tem nome). */
	institutionKey: z.string(),
	institutionLabel: z.string(),
	/** Saldo líquido, valor bruto, aplicado e disponível para resgate; `null` = o banco não informou. */
	balanceCents: cents.nullable(),
	grossCents: cents.nullable(),
	investedCents: cents.nullable(),
	withdrawableCents: cents.nullable(),
	incomeTaxCents: cents.nullable(),
	yield: investmentYieldDto,
	/** Decimais em texto. */
	quantity: z.string().nullable(),
	unitValue: z.string().nullable(),
	/** Remuneração contratada (ex.: 110 + "CDI"); NÃO é rentabilidade medida. */
	rate: z.string().nullable(),
	rateType: z.string().nullable(),
	fixedAnnualRate: z.string().nullable(),
	positionDate: localDateSchema.nullable(),
	dueDate: localDateSchema.nullable(),
	issueDate: localDateSchema.nullable(),
	purchaseDate: localDateSchema.nullable(),
	issuer: z.string().nullable(),
	/** Última vez que a sincronização viu a posição. */
	syncedAt: timestampSchema,
	archivedAt: timestampSchema.nullable(),
	/**
	 * Só renda fixa ATIVA em reais tem taxa e rendimento esperado (`termsApplicable`). Nas outras, `terms` é tudo `null`,
	 * `missing` vazio e o resto `null`.
	 */
	termsApplicable: z.boolean().optional(),
	terms: investmentTermsDto.optional(),
	/** O que falta para calcular o esperado (vazio = dá para calcular, salvo `expectedUnavailable`). */
	missing: z.array(investmentMissingSchema).optional(),
	/** Sugestão pelo nome, só quando falta a taxa e o nome traz uma inequívoca. */
	nameHint: investmentNameHintDto.nullable().optional(),
	/** `null` quando falta dado (veja `missing`) ou o cálculo não se aplica (veja `expectedUnavailable`). */
	expected: investmentExpectedDto.nullable().optional(),
	/** Por que `expected` é `null` mesmo sem `missing`: `ipca_unsupported` ou `cdi_unavailable`. */
	expectedUnavailable: z
		.object({ code: z.enum(["ipca_unsupported", "cdi_unavailable"]), message: z.string() })
		.nullable()
		.optional(),
	/** Saldo do banco − esperado BRUTO. `null` sem saldo ou sem esperado. Positivo = o banco informa mais que o esperado. */
	gapCents: cents.nullable().optional(),
	/** Saldo do banco − (aplicado + rendimento LÍQUIDO estimado). `null` se não há líquido. */
	gapNetCents: cents.nullable().optional(),
});
export type InvestmentPositionDto = z.infer<typeof investmentPositionDto>;

/** Uma fatia do patrimônio (por classe ou por instituição). Só grupos com saldo. Soma de `shareBps` = 10000. */
export const investmentGroupDto = z.object({
	/** Classe: o id da classe; instituição: o id da conexão. */
	key: z.string(),
	label: z.string(),
	balanceCents: cents,
	shareBps: bps,
	positions: z.number().int(),
});
export type InvestmentGroupDto = z.infer<typeof investmentGroupDto>;

export const investmentClassGroupDto = investmentGroupDto.extend({ class: investmentClassSchema });
export type InvestmentClassGroupDto = z.infer<typeof investmentClassGroupDto>;

/**
 * Rendimento desde sempre da carteira ATIVA (soma das posições em que deu para calcular).
 * `cents: null` = nenhuma deu (`reason` diz por quê). `estimated`: alguma parcela é estimada.
 * `missingPositions > 0`: o número NÃO cobre todas as posições ativas (a tela deve dizer "de N posições").
 */
export const investmentTotalYieldDto = z.object({
	cents: cents.nullable(),
	estimated: z.boolean(),
	returnBps: bps.nullable(),
	countedPositions: z.number().int(),
	missingPositions: z.number().int(),
	reason: z.string().nullable(),
});
export type InvestmentTotalYieldDto = z.infer<typeof investmentTotalYieldDto>;

/**
 * Rendimento de um mês: variação do saldo descontando aportes e resgates do mês, a partir dos retratos diários.
 * `cents: null` com `reason` ("sem histórico ainda") enquanto não há retrato do fim do mês anterior.
 * `baselineDay`: de que dia a medição parte (pode ser até 5 dias antes do início do mês). `partial`: cobre só parte
 * das posições (as outras não têm retrato). Nunca é estimado.
 */
export const investmentMonthYieldDto = z.object({
	month: monthKeySchema,
	cents: cents.nullable(),
	partial: z.boolean(),
	countedPositions: z.number().int(),
	missingPositions: z.number().int(),
	baselineDay: localDateSchema.nullable(),
	reason: z.string().nullable(),
});
export type InvestmentMonthYieldDto = z.infer<typeof investmentMonthYieldDto>;

/** Aportes (compras) e resgates (vendas) de um mês, exatos, e o rendimento do mês (pode ser `null`). */
export const investmentMonthlyDto = z.object({
	month: monthKeySchema,
	contributionsCents: cents,
	withdrawalsCents: cents,
	netContributionsCents: cents,
	yieldCents: cents.nullable(),
	yieldPartial: z.boolean(),
	yieldReason: z.string().nullable(),
});
export type InvestmentMonthlyDto = z.infer<typeof investmentMonthlyDto>;

/** `GET /v1/investments`. */
export const investmentsOverviewResponse = z.object({
	/** Hoje (America/Sao_Paulo); referência de "agora". */
	asOf: localDateSchema,
	/** `false` = nenhum investimento foi sincronizado (nem encerrado): mostre o estado vazio. */
	hasData: z.boolean(),
	/** Quando a sincronização viu uma posição pela última vez (a mais recente); `null` sem posições. */
	syncedAt: timestampSchema.nullable(),
	/** Patrimônio: soma dos saldos das posições ativas em reais. */
	totalCents: cents,
	activePositions: z.number().int(),
	/** Ativas sem saldo informado (fora da soma) e ativas em outra moeda (fora da soma). */
	withoutBalance: z.number().int(),
	foreignCurrency: z.number().int(),
	/** Posições de renda fixa ativas a que falta taxa, valor aplicado ou data para calcular o esperado. */
	missingTermsPositions: z.number().int().optional(),
	/** Resgatadas por inteiro ou sumidas da lista (não aparecem em `positions`). */
	closedPositions: z.number().int(),
	yield: z.object({
		/** Desde sempre. */
		total: investmentTotalYieldDto,
		/** Do mês corrente. */
		month: investmentMonthYieldDto,
	}),
	byClass: z.array(investmentClassGroupDto),
	byInstitution: z.array(investmentGroupDto),
	/** Posições ativas, do maior saldo para o menor. */
	positions: z.array(investmentPositionDto),
	/** Aportes e rendimento dos últimos 6 meses (do mais antigo ao mais novo). */
	monthly: z.array(investmentMonthlyDto),
});
export type InvestmentsOverviewResponse = z.infer<typeof investmentsOverviewResponse>;

/** BUY = aporte/compra, SELL = resgate/venda, o resto (juros, imposto, transferência) = other. */
export const investmentMovementKindSchema = z.enum(["contribution", "withdrawal", "other"]);

export const investmentMovementDto = z.object({
	id: idSchema,
	type: z.string().nullable(),
	movementType: z.string().nullable(),
	kind: investmentMovementKindSchema,
	date: localDateSchema.nullable(),
	tradeDate: localDateSchema.nullable(),
	/** Valor bruto da operação, SEM sinal (o sentido está em `kind`). */
	amountCents: cents.nullable(),
	netAmountCents: cents.nullable(),
	quantity: z.string().nullable(),
	unitValue: z.string().nullable(),
	/** Texto do banco: dado, nunca instrução. */
	description: z.string().nullable(),
});
export type InvestmentMovementDto = z.infer<typeof investmentMovementDto>;

export const investmentSnapshotDto = z.object({
	day: localDateSchema,
	balanceCents: cents,
	investedCents: cents.nullable(),
});
export type InvestmentSnapshotDto = z.infer<typeof investmentSnapshotDto>;

/**
 * `GET /v1/investments/:id`: a posição (ativa ou não), as movimentações da mais recente para a mais antiga e os
 * retratos diários dela (do mais antigo ao mais novo; vazio até o primeiro sync que gravou saldo). 404 se não existe.
 * Posição de uma conexão REMOVIDA também abre (200): `active: false` e `institutionLabel: "Conexão removida"`; ela não
 * entra no resumo nem na evolução.
 */
export const investmentDetailResponse = z.object({
	position: investmentPositionDto,
	movements: z.array(investmentMovementDto),
	snapshots: z.array(investmentSnapshotDto),
});
export type InvestmentDetailResponse = z.infer<typeof investmentDetailResponse>;

export const investmentEvolutionPointDto = z.object({
	day: localDateSchema,
	/** Patrimônio do dia: soma dos saldos dos retratos daquele dia. */
	balanceCents: cents,
	/**
	 * Aplicado do dia: o do banco quando veio; senão compras − vendas até o dia (`investedEstimated`). Se alguma
	 * posição não tem como saber, `investedComplete` é falso e a soma cobre só o que se sabe.
	 */
	investedCents: cents,
	investedEstimated: z.boolean(),
	investedComplete: z.boolean(),
	/** Quantos retratos DO DIA compõem o ponto. */
	positions: z.number().int(),
	/** Posições que não sincronizaram neste dia e entraram pelo último retrato (até 5 dias antes). */
	carriedPositions: z.number().int(),
	/**
	 * Posições conhecidas cujo último retrato é velho demais: ficaram FORA da soma. `> 0` = o ponto subestima o
	 * patrimônio (dia incompleto, não resgate): a tela deve marcá-lo ou não ligar a linha até ele.
	 */
	missingPositions: z.number().int(),
});
export type InvestmentEvolutionPointDto = z.infer<typeof investmentEvolutionPointDto>;

/**
 * `GET /v1/investments/evolution?range=`: série dos dias COM retrato entre `from` e `to`. Dias sem sincronização
 * simplesmente não aparecem (a API não preenche nem interpola). `points` vazio traz `reason` ("sem histórico ainda").
 */
export const investmentEvolutionResponse = z.object({
	range: investmentEvolutionRangeSchema,
	from: localDateSchema,
	to: localDateSchema,
	/** O primeiro dia com retrato (de qualquer faixa); `null` se ainda não há nenhum. */
	coveredFrom: localDateSchema.nullable(),
	points: z.array(investmentEvolutionPointDto),
	reason: z.string().nullable(),
});
export type InvestmentEvolutionResponse = z.infer<typeof investmentEvolutionResponse>;

/** `PUT /v1/investments/:id/terms`: devolve a posição já com o esperado recalculado. */
export const investmentTermsResponse = z.object({ position: investmentPositionDto });
export type InvestmentTermsResponse = z.infer<typeof investmentTermsResponse>;
export type InvestmentNameHintDto = z.infer<typeof investmentNameHintDto>;
