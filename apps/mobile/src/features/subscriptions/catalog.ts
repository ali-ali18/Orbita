/*
 * Catálogo local de assinaturas comuns no Brasil, para "Buscar serviço" em Nova assinatura. Dado estático do
 * app, sem rede. Só nome e categoria padrão: o Figma não mostra preço de catálogo (o "R$ 44,90" da Netflix
 * vem do histórico do dono, não daqui), e preço de plano muda com frequência, então nenhum valor é sugerido.
 */

export interface CatalogService {
	id: string;
	name: string;
	/** Nome curto da grade de atalhos (o Figma mostra "YouTube" e "Prime"). */
	shortName?: string;
	/** Nome da categoria padrão; vira o id da categoria do dono pelo nome (`categoryIdByName`). */
	category: "Assinaturas" | "Saúde";
	/** Outros jeitos de procurar: sigla, nome antigo, empresa. */
	aliases?: readonly string[];
	/** Entra na grade de atalhos (na ordem do Figma). */
	featured?: boolean;
}

export const SERVICE_CATALOG: readonly CatalogService[] = [
	{ id: "netflix", name: "Netflix", category: "Assinaturas", featured: true },
	{ id: "spotify", name: "Spotify", category: "Assinaturas", featured: true },
	{
		id: "youtube-premium",
		name: "YouTube Premium",
		shortName: "YouTube",
		category: "Assinaturas",
		aliases: ["youtube", "youtube music"],
		featured: true,
	},
	{
		id: "google-one",
		name: "Google One",
		category: "Assinaturas",
		aliases: ["google", "google drive"],
		featured: true,
	},
	{
		id: "prime-video",
		name: "Prime Video",
		shortName: "Prime",
		category: "Assinaturas",
		aliases: ["amazon", "amazon prime", "prime"],
		featured: true,
	},
	{
		id: "disney-plus",
		name: "Disney+",
		category: "Assinaturas",
		aliases: ["disney", "star+"],
		featured: true,
	},
	{
		id: "icloud",
		name: "iCloud",
		category: "Assinaturas",
		aliases: ["icloud+", "apple icloud"],
		featured: true,
	},
	{ id: "max", name: "Max", category: "Assinaturas", aliases: ["hbo", "hbo max"] },
	{ id: "apple", name: "Apple", category: "Assinaturas", aliases: ["apple one", "apple tv", "apple music"] },
	{ id: "globoplay", name: "Globoplay", category: "Assinaturas", aliases: ["globo"] },
	{ id: "deezer", name: "Deezer", category: "Assinaturas" },
	{ id: "paramount-plus", name: "Paramount+", category: "Assinaturas", aliases: ["paramount"] },
	{ id: "telecine", name: "Telecine", category: "Assinaturas" },
	{ id: "crunchyroll", name: "Crunchyroll", category: "Assinaturas" },
	{
		id: "academia",
		name: "Academia",
		category: "Saúde",
		aliases: ["smart fit", "bluefit", "gym", "ginástica"],
	},
];

/** Minúsculas, sem acento e sem espaço sobrando: "Disney+" casa com "disney". */
const plain = (text: string) =>
	text
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase()
		.trim();

/** Os atalhos da grade, na ordem do Figma. */
export function featuredServices(catalog: readonly CatalogService[] = SERVICE_CATALOG): CatalogService[] {
	return catalog.filter((s) => s.featured);
}

/**
 * Serviços que casam com o que foi digitado: primeiro os que começam com o texto (no nome ou num apelido),
 * depois os que só contêm. Texto vazio não sugere nada (a grade de atalhos cobre esse caso).
 */
export function searchServices(
	query: string,
	catalog: readonly CatalogService[] = SERVICE_CATALOG,
	limit = 5,
): CatalogService[] {
	const q = plain(query);
	if (q === "") return [];
	const scored: { service: CatalogService; rank: number; index: number }[] = [];
	catalog.forEach((service, index) => {
		const names = [service.name, ...(service.aliases ?? [])].map(plain);
		if (names.some((n) => n.startsWith(q))) scored.push({ service, rank: 0, index });
		else if (names.some((n) => n.includes(q))) scored.push({ service, rank: 1, index });
	});
	return scored
		.sort((a, b) => a.rank - b.rank || a.index - b.index)
		.slice(0, limit)
		.map((s) => s.service);
}

/** O serviço do catálogo cujo nome é exatamente `name` (sem olhar caixa nem acento), se houver. */
export function serviceByName(
	name: string,
	catalog: readonly CatalogService[] = SERVICE_CATALOG,
): CatalogService | undefined {
	const n = plain(name);
	return n === "" ? undefined : catalog.find((s) => plain(s.name) === n);
}

/** Id da categoria ativa do dono com esse nome (sem olhar caixa nem acento); `null` se não existe. */
export function categoryIdByName(
	categories: readonly { id: string; name: string; archivedAt: string | null }[],
	name: string,
): string | null {
	return categories.find((c) => c.archivedAt === null && plain(c.name) === plain(name))?.id ?? null;
}
