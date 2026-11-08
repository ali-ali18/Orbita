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
}

const sub = (
	name: string,
	brands: string[],
	categorySlug: KnownService["categorySlug"] = "assinaturas",
): KnownService => ({ name, brands, categorySlug, subscription: true });

export const KNOWN_SERVICES: readonly KnownService[] = [
	sub("Netflix", ["netflix"]),
	sub("Spotify", ["spotify"]),
	sub("YouTube Premium", ["youtube"]),
	sub("Google One", ["google"]),
	sub("Prime Video", ["amazonprime", "primevideo"]),
	sub("Disney+", ["disney", "disneyplus"]),
	sub("iCloud", ["icloud", "apple"]),
	sub("HBO Max", ["hbo", "hbomax"]),
	sub("Globoplay", ["globoplay"]),
	sub("Deezer", ["deezer"]),
	sub("ChatGPT", ["openai", "chatgpt"]),
	sub("Claude", ["anthropic", "claude"]),
	sub("Microsoft 365", ["microsoft"]),
	sub("Adobe", ["adobe"]),
	sub("Canva", ["canva"]),
	sub("Notion", ["notion"]),
	sub("Dropbox", ["dropbox"]),
	sub("Duolingo", ["duolingo"]),
	sub("Paramount+", ["paramount"]),
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
	const brand = merchantKey(merchant, 1);
	return brand === "" ? null : (BY_BRAND.get(brand) ?? null);
}

/** Marcas dos serviços de assinatura: com elas bastam duas cobranças. */
export const KNOWN_SUBSCRIPTION_BRANDS: ReadonlySet<string> = new Set(
	KNOWN_SERVICES.filter((s) => s.subscription).flatMap((s) => s.brands),
);
