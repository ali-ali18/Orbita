import { merchantKey } from "./merchant.ts";

/*
 * Serviços conhecidos, para a análise do histórico ("Configurar com a Órbita"). Servem a duas coisas: com um serviço
 * conhecido bastam DUAS cobranças mensais para considerar assinatura (em vez de três) e a categoria padrão dele
 * (por `slug`) é o palpite quando o banco não ajuda. Só nome e marca: nenhum preço (planos mudam).
 * O catálogo da tela "Nova assinatura" é outro (fica no app); este é do servidor.
 */

export interface KnownService {
	name: string;
	/** Marcas como `merchantKey(texto, 1)` as vê: a primeira palavra do estabelecimento, sem acento nem número. */
	brands: readonly string[];
	/** Slug da categoria padrão do sistema. */
	categorySlug: "assinaturas" | "saude" | "delivery" | "transporte";
	/** `true` = cobrança mensal fixa (assinatura); `false` = só dica de categoria (iFood, Uber). */
	subscription: boolean;
	/** Nome curto para mostrar ao dono (o do app, sem explicação entre parênteses). Padrão: `name`. */
	short?: string;
}

const sub = (
	name: string,
	brands: string[],
	categorySlug: KnownService["categorySlug"] = "assinaturas",
	short?: string,
): KnownService => ({ name, brands, categorySlug, subscription: true, ...(short ? { short } : {}) });

export const KNOWN_SERVICES: readonly KnownService[] = [
	sub("Netflix", ["netflix"]),
	sub("Spotify", ["spotify"]),
	sub("YouTube (Premium ou Music)", ["youtube"], "assinaturas", "YouTube"),
	sub("Google One (Gemini)", ["googleone"], "assinaturas", "Google One"),
	sub("Prime Video", ["amazonprime", "primevideo"]),
	sub("Disney+", ["disney", "disneyplus"]),
	sub("iCloud", ["icloud", "apple"]),
	sub("HBO Max", ["hbo", "hbomax"]),
	sub("Globoplay", ["globoplay"]),
	sub("Deezer", ["deezer"]),
	sub("ChatGPT", ["openai", "chatgpt"]),
	sub("Claude", ["anthropic", "claude"]),
	sub("Grok (SuperGrok)", ["grok"], "assinaturas", "Grok"),
	sub("F1 TV", ["f1"]),
	sub("Microsoft 365", ["microsoft"]),
	sub("Adobe", ["adobe"]),
	sub("Canva", ["canva"]),
	sub("Notion", ["notion"]),
	sub("Dropbox", ["dropbox"]),
	sub("Duolingo", ["duolingo"]),
	sub("Paramount+", ["paramount"]),
	sub("Apple Music", ["applemusic"]),
	sub("Crunchyroll", ["crunchyroll"]),
	sub("Tidal", ["tidal"]),
	sub("GitHub", ["github"]),
	sub("LinkedIn", ["linkedin"]),
	sub("Cursor", ["cursor"]),
	sub("Midjourney", ["midjourney"]),
	sub("Xbox Game Pass", ["xbox"]),
	sub("PlayStation Plus", ["playstation", "psn"]),
	sub("Telecine", ["telecine"]),
	sub("Premiere", ["premiere"]),
	sub("Smart Fit", ["smartfit"], "saude"),
	sub("Gympass", ["gympass", "wellhub"], "saude"),
	{ name: "iFood", brands: ["ifood"], categorySlug: "delivery", subscription: false },
	{ name: "Rappi", brands: ["rappi"], categorySlug: "delivery", subscription: false },
	{ name: "Uber", brands: ["uber"], categorySlug: "transporte", subscription: false },
];

const BY_BRAND: ReadonlyMap<string, KnownService> = new Map(
	KNOWN_SERVICES.flatMap((s) => s.brands.map((b) => [b, s] as const)),
);

/** O serviço conhecido de um estabelecimento (pela marca), ou `null`. */
export function knownServiceOf(merchant: string | null | undefined): KnownService | null {
	const brand = subscriptionBrand(merchant);
	return brand === "" ? null : (BY_BRAND.get(brand) ?? null);
}

/** Intermediários de pagamento que aparecem antes do nome real ("PAYPAL *GOOGLE", "DL*GOOGLE YouTube", "PG *Spotify"). */
const PAYMENT_PROCESSORS: ReadonlySet<string> = new Set([
	"paypal",
	"pp",
	"dl",
	"dlocal",
	"pg",
	"mp",
	"mercadopago",
	"ebanx",
	"pagseguro",
	"pagarme",
	"stripe",
	"hotmart",
	"eduzz",
	"kiwify",
	"iugu",
	"vindi",
	"sumup",
	"adyen",
	"www",
	"compra",
]);

/**
 * Serviços que o mesmo emissor cobra com nomes diferentes: a marca de assinatura precisa separar "Google One" de
 * "YouTube Music" (os dois chegam como "GOOGLE *..."), senão as cobranças se misturam e nenhuma forma sequência.
 * Casa sobre o texto sem espaços; a primeira regra que bater vence.
 */
const BRAND_RULES: ReadonlyArray<readonly [brand: string, match: RegExp]> = [
	["youtube", /youtube/],
	["googleone", /google(one|storage|drive)|gemini|googleai/],
	// ChatGPT: o mesmo serviço chega como "OPENAI *CHATGPT SUBSCR" (direto) e como "DL*GOOGLE ChatGP" (Google Play).
	["chatgpt", /chatgpt|openai/],
	["grok", /grok/],
	["amazonprime", /amazon(prime|music|kindle)|primevideo/],
	["applemusic", /applemusic/],
	["icloud", /icloud|appleservices/],
	["xbox", /xbox|microsoftgamepass/],
	["playstation", /playstation|psnetwork/],
];

/**
 * Apps vendidos pelo Google Play que o banco TRUNCA ("YouTub", "ChatGP", "Googl"): o texto cortado casa por prefixo
 * (pelo menos 4 letras) e volta ao nome inteiro, que é a marca de assinatura. "google" sozinho como app é o Google One.
 */
const GOOGLE_PLAY_APPS: readonly string[] = ["youtube", "chatgpt", "googleone", "gemini"];

/** Palavras do texto do banco depois de "GOOGLE" que não dizem qual app foi vendido. */
const GOOGLE_PLAY_NOISE: ReadonlySet<string> = new Set([
	"brasil",
	"br",
	"ltda",
	"play",
	"payment",
	"pagamento",
	"llc",
	"inc",
	"ireland",
	"com",
	"gsuite",
	"internet",
	"servicos",
	"online",
]);

const canonicalGoogleApp = (token: string): string => {
	if (token.length < 4) return token;
	return GOOGLE_PLAY_APPS.find((full) => full.startsWith(token)) ?? token;
};

/**
 * Cobrança do Google Play ("Google One", "DL*GOOGLE YouTub", "DL *GOOGLE Pierre Cont"): o banco escreve o intermediário
 * e depois o app vendido, e a marca é o APP (o texto depois do último "google"), não o Google. Devolve a marca do app,
 * ou `null` quando o texto não é do Google. "Google" sozinho (ou "Google Brasil") sem app é `google`. Texto que repete
 * "google" sem nada depois ("DL*GOOGLE Google", que é o Google One cobrado como "Google") é `googleone`.
 */
function googlePlayBrand(tokens: readonly string[]): string | null {
	let last = -1;
	let count = 0;
	tokens.forEach((t, i) => {
		if (t === "google") {
			last = i;
			count += 1;
		}
	});
	if (last < 0) return null;
	const app = tokens.slice(last + 1).filter((t) => !GOOGLE_PLAY_NOISE.has(t) && !PAYMENT_PROCESSORS.has(t));
	const first = app[0];
	if (first === undefined) return count >= 2 ? "googleone" : "google";
	return canonicalGoogleApp(first);
}

const brandTokens = (text: string | null | undefined): string[] => {
	const tokens = merchantKey(text, 40)
		.split(" ")
		.filter((t) => t !== "");
	while (tokens.length > 1 && PAYMENT_PROCESSORS.has(tokens[0] as string)) tokens.shift();
	return tokens;
};

/**
 * Compra de um app pelo Google Play, com o app dito: "Google Pierre Control", "DL*GOOGLE YouTub", "Google One". São
 * quase sempre assinaturas, então duas cobranças mensais bastam (como nas marcas conhecidas). "Google" sozinho não é.
 */
export function isGooglePlayApp(text: string | null | undefined): boolean {
	const brand = googlePlayBrand(brandTokens(text));
	return brand !== null && brand !== "google";
}

/**
 * A "marca de assinatura" de um texto de estabelecimento: tira o intermediário de pagamento do começo, reconhece os
 * serviços de {@link BRAND_RULES} em qualquer ponto do texto, no Google Play usa o app vendido (cada app é uma
 * assinatura à parte, mesmo cobrados todos como "GOOGLE *...") e, no resto, a primeira palavra (como `merchantKey`
 * com 1 palavra). Vazio quando não sobra nada comparável.
 */
export function subscriptionBrand(text: string | null | undefined): string {
	const tokens = brandTokens(text);
	const joined = tokens.join("");
	for (const [brand, match] of BRAND_RULES) if (match.test(joined)) return brand;
	// "X.AI", "xAI LLC": o Grok cobrado pela empresa, sem a palavra "grok".
	if (tokens[0] === "xai" || (tokens[0] === "x" && tokens[1] === "ai")) return "grok";
	const play = googlePlayBrand(tokens);
	// "Google Play" sem o app dito: a marca é a loja.
	if (play === "google" && /googleplay/.test(joined)) return "googleplay";
	return play ?? tokens[0] ?? "";
}

/** Produtos do próprio Google: aparecem no extrato como "Google ..." e não precisam do aviso "(Google Play)". */
const GOOGLE_OWN_BRANDS: ReadonlySet<string> = new Set(["youtube", "googleone", "google", "googleplay"]);
/** Serviços que também se assinam direto no site: o nome diz por onde a cobrança passa, para o dono saber onde cancelar. */
const ALSO_SOLD_DIRECT: ReadonlySet<string> = new Set(["chatgpt", "claude", "grok"]);

const titleCase = (word: string): string => `${word.charAt(0).toLocaleUpperCase("pt-BR")}${word.slice(1)}`;

/**
 * Nome amigável do serviço por trás de uma cobrança, para mostrar ao dono no lugar do nome do banco ("GOOGLE BRASIL
 * INTERNET LTDA.", "DL*GOOGLE ChatGP"): o nome curto do catálogo ("YouTube", "Google One", "F1 TV"; "ChatGPT (Google
 * Play)" quando o serviço também se assina direto), ou o app vendido pelo Google Play ("Google Pierre Control" →
 * "Pierre"). `null` quando não dá para saber (o chamador usa o nome limpo do estabelecimento).
 */
export function serviceDisplayName(text: string | null | undefined): string | null {
	const tokens = brandTokens(text);
	if (tokens.length === 0) return null;
	const brand = subscriptionBrand(text);
	const known = BY_BRAND.get(brand) ?? null;
	const viaGoogle = tokens.includes("google") && !GOOGLE_OWN_BRANDS.has(brand);
	if (known) {
		const base = known.short ?? known.name;
		return viaGoogle && ALSO_SOLD_DIRECT.has(brand) ? `${base} (Google Play)` : base;
	}
	if (viaGoogle && isGooglePlayApp(text)) return titleCase(brand);
	return null;
}

/** Duas marcas são do mesmo serviço: iguais, ou uma começa pela outra ("amazon" cadastrado, "amazonprime" cobrado). */
export function sameSubscriptionBrand(a: string, b: string): boolean {
	if (a === "" || b === "") return false;
	if (a === b) return true;
	const [short, long] = a.length <= b.length ? [a, b] : [b, a];
	return short.length >= 4 && long.startsWith(short);
}

/** Marcas dos serviços de assinatura: com elas bastam duas cobranças. */
export const KNOWN_SUBSCRIPTION_BRANDS: ReadonlySet<string> = new Set(
	KNOWN_SERVICES.filter((s) => s.subscription).flatMap((s) => s.brands),
);
