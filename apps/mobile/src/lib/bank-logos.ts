/*
 * Logos dos bancos: de qual instituição é uma conta, cartão ou conexão. Função pura (sem os arquivos de imagem,
 * que ficam em `ui/bank-logo-assets.ts`), para poder ser testada. Os PNGs vêm do pacote `logos-bancos-br`
 * (MIT; as marcas são das instituições, uso só para identificá-las).
 */

/** ISPB do banco que dá nome ao arquivo do logo (`assets/banks/<ispb>.png`). */
export const BANK_LOGO_KEYS = [
	"18236120", // Nubank
	"00416968", // Inter
	"90400888", // Santander
	"10573521", // Mercado Pago
	"60701190", // Itaú
	"60746948", // Bradesco
	"00000000", // Banco do Brasil
	"00360305", // Caixa
	"31872495", // C6 Bank
	"30306294", // BTG Pactual
	"22896431", // PicPay
	"92894922", // Original
	"08561701", // PagBank
	"20855875", // Neon
	"02038232", // Sicoob
	"01181521", // Sicredi
	"58160789", // Safra
	"92702067", // Banrisul
	"33264668", // XP
	"01858774", // BV
	"59285411", // Pan
	"10664513", // Agibank
	"27098060", // Digio
	"37880206", // Cora
	"61186680", // BMG
	"16501555", // Stone
	"60889128", // Sofisa
] as const;
export type BankLogoKey = (typeof BANK_LOGO_KEYS)[number];

/** ISPBs de outras empresas do mesmo banco que usam o logo dele. */
const SAME_BRAND: Readonly<Record<string, BankLogoKey>> = {
	"30680829": "18236120", // Nu Financeira
	"60394079": "60701190", // ItaúBank
	"29162769": "90400888", // Santander Corretora
};

/**
 * Nomes que identificam o banco, já sem acento nem maiúsculas, procurados como palavras inteiras ("inter" não casa
 * "internacional"). Prefixo `=` = o nome inteiro tem que ser igual (evita "Caixa" de dinheiro virar Caixa Econômica).
 * Ordem importa: o primeiro banco que casa vence ("banco inter" antes de "inter", "itau" só depois de "santander").
 */
const NAME_ALIASES: readonly (readonly [BankLogoKey, readonly string[]])[] = [
	["18236120", ["nubank", "nu pagamentos", "nu financeira", "nu conta"]],
	["00416968", ["banco inter", "inter"]],
	["90400888", ["santander"]],
	["10573521", ["mercado pago", "mercadopago"]],
	["60701190", ["itau", "itaubank"]],
	["60746948", ["bradesco"]],
	["00000000", ["banco do brasil", "bb"]],
	["00360305", ["caixa economica", "=caixa", "=cef"]],
	["31872495", ["c6 bank", "c6"]],
	["30306294", ["btg pactual", "btg"]],
	["22896431", ["picpay", "pic pay"]],
	["92894922", ["banco original"]],
	["08561701", ["pagbank", "pagseguro"]],
	["20855875", ["neon"]],
	["02038232", ["sicoob"]],
	["01181521", ["sicredi"]],
	["58160789", ["banco safra", "safra"]],
	["92702067", ["banrisul"]],
	["33264668", ["banco xp", "xp investimentos", "xp"]],
	["01858774", ["banco bv", "bv"]],
	["59285411", ["banco pan"]],
	["10664513", ["agibank"]],
	["27098060", ["digio"]],
	["37880206", ["cora"]],
	["61186680", ["banco bmg", "bmg"]],
	["16501555", ["stone"]],
	["60889128", ["sofisa"]],
];

const normalize = (text: string) =>
	text
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim();

const isKey = (value: string): value is BankLogoKey => (BANK_LOGO_KEYS as readonly string[]).includes(value);

/**
 * Logo do banco: primeiro pelo ISPB (`bankCode`); sem ele (o Meu Pluggy só manda o nome do conector), pelo nome.
 * `null` = sem logo, e quem desenha usa a inicial.
 */
export function bankLogoKey(bank: {
	bankCode?: string | null | undefined;
	name?: string | null | undefined;
}): BankLogoKey | null {
	const code = bank.bankCode?.trim();
	if (code) {
		if (isKey(code)) return code;
		const same = SAME_BRAND[code];
		if (same) return same;
	}
	const name = bank.name ? normalize(bank.name) : "";
	if (!name) return null;
	const padded = ` ${name} `;
	for (const [key, aliases] of NAME_ALIASES) {
		for (const alias of aliases) {
			if (alias.startsWith("=") ? name === alias.slice(1) : padded.includes(` ${alias} `)) return key;
		}
	}
	return null;
}
