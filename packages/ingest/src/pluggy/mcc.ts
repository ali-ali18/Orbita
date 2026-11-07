import type { SpendingSlug } from "./classify.ts";

/*
 * Categoria do Órbita pelo código do estabelecimento. Funções puras.
 *
 * MCC (ISO 18245, 4 dígitos) vem em `creditCardMetadata.payeeMCC`; CNAE (7 dígitos) em `merchant.cnae`. Os dois são
 * sinais do estabelecimento, mais estáveis que o texto da categoria do Pluggy. Códigos ambíguos (loja de departamento,
 * "serviços diversos") ficam de fora de propósito: sem palpite, cai na categoria do Pluggy e depois em "Outros".
 * A tabela é conhecimento geral dos códigos, não conferida contra dados reais do dono (ver docs/pluggy.md).
 */

type Entry = readonly [
	slug: Exclude<SpendingSlug, "outros">,
	codes: ReadonlyArray<number | readonly [number, number]>,
];

const MCC_TABLE: readonly Entry[] = [
	// Supermercado, açougue, laticínio, conveniência, atacado/clube de compras.
	["mercado", [5411, 5422, 5441, 5451, 5499, 5300, 5297, 5298]],
	// Restaurante, bar, lanchonete, padaria, entrega de comida.
	["delivery", [5811, 5812, 5813, 5814, 5462, 5333]],
	// Transporte por aplicativo/táxi, ônibus, trem, pedágio, combustível, estacionamento, locadora, oficina.
	[
		"transporte",
		[
			4111, 4112, 4121, 4131, 4784, 5541, 5542, 5983, 7523, 7512, 7511, 7531, 7534, 7535, 7538, 7542, 5533,
			4789,
		],
	],
	// TV a cabo/streaming, mídia digital, software, compras recorrentes por assinatura.
	["assinaturas", [4899, 5815, 5817, 5818, 5734, 5968, 7372, 7379]],
	// Cinema, teatro, parques, clubes, academia, jogos, viagem (companhias aéreas, hotéis, agências).
	[
		"lazer",
		[
			7832,
			7922,
			7996,
			7941,
			7991,
			7992,
			7993,
			7994,
			7997,
			7999,
			7911,
			7929,
			5816,
			5941,
			5945,
			5947,
			4511,
			4722,
			7011,
			4411,
			4457,
			[3000, 3299],
			[3500, 3999],
		],
	],
	// Farmácia, médicos, dentistas, hospitais, laboratórios, ótica.
	["saude", [5912, 5122, 8011, 8021, 8031, 8041, 8042, 8043, 8049, 8050, 8062, 8071, 8099, 5975, 5976]],
	// Aluguel/imobiliária, serviços públicos (luz, água, gás), telefonia, móveis e material de construção.
	["moradia", [6513, 4900, 4814, 4812, 5712, 5713, 5719, 5200, 5211, 5231, 5251, 5261, 5714, 1711, 1731]],
];

const MCC_INDEX: ReadonlyMap<number, Exclude<SpendingSlug, "outros">> = (() => {
	const index = new Map<number, Exclude<SpendingSlug, "outros">>();
	for (const [slug, codes] of MCC_TABLE) {
		for (const code of codes) {
			if (typeof code === "number") {
				if (!index.has(code)) index.set(code, slug);
			} else {
				for (let c = code[0]; c <= code[1]; c++) if (!index.has(c)) index.set(c, slug);
			}
		}
	}
	return index;
})();

/** Categoria pelo MCC (número ou texto de 4 dígitos). `null` se o código é desconhecido, zero ou ambíguo. */
export function categoryForMcc(
	mcc: number | string | null | undefined,
): Exclude<SpendingSlug, "outros"> | null {
	if (mcc === null || mcc === undefined) return null;
	const code = typeof mcc === "number" ? mcc : /^\d{1,4}$/.test(mcc.trim()) ? Number(mcc.trim()) : Number.NaN;
	if (!Number.isInteger(code) || code <= 0) return null;
	return MCC_INDEX.get(code) ?? null;
}

/** Grupos de CNAE (4 primeiros dígitos da classe) → categoria. */
const CNAE_TABLE: ReadonlyArray<readonly [Exclude<SpendingSlug, "outros">, readonly string[]]> = [
	["mercado", ["4711", "4712", "4713", "4721", "4722", "4724", "4729"]],
	["delivery", ["5611", "5612", "5622", "5629"]],
	[
		"transporte",
		["4731", "4732", "4921", "4922", "4923", "4924", "4929", "4930", "4911", "4912", "7711", "4520", "4530"],
	],
	["assinaturas", ["6020", "6110", "6141", "6190", "6201", "6202", "6203", "6204", "6209", "6311", "5911"]],
	["saude", ["4771", "8610", "8621", "8622", "8630", "8640", "8650", "8660", "8690", "4773"]],
	[
		"moradia",
		[
			"3511",
			"3512",
			"3513",
			"3514",
			"3600",
			"3601",
			"3602",
			"6810",
			"6821",
			"6822",
			"4399",
			"4743",
			"4744",
			"4754",
		],
	],
	[
		"lazer",
		[
			"5510",
			"5590",
			"7911",
			"7912",
			"7990",
			"9001",
			"9002",
			"9003",
			"9102",
			"9200",
			"9311",
			"9312",
			"9313",
			"9319",
			"9321",
			"9329",
			"5111",
			"5112",
		],
	],
];

const CNAE_INDEX: ReadonlyMap<string, Exclude<SpendingSlug, "outros">> = new Map(
	CNAE_TABLE.flatMap(([slug, groups]) => groups.map((g) => [g, slug] as const)),
);

/** Categoria pelo CNAE (qualquer formato: "4711-3/02", "4711302"). Usa os 4 primeiros dígitos. */
export function categoryForCnae(cnae: string | null | undefined): Exclude<SpendingSlug, "outros"> | null {
	const digits = (cnae ?? "").replace(/\D/g, "");
	if (digits.length < 4) return null;
	return CNAE_INDEX.get(digits.slice(0, 4)) ?? null;
}
