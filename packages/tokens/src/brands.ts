/**
 * Disco de cada loja ou serviço que o app reconhece, imitando o ÍCONE DE APP oficial da marca como aparece na tela do
 * celular: fundo e glifo, escolhidos para o glifo passar AA (4,5:1) sobre o disco. Onde o ícone oficial é preto ou
 * escuro com logo colorido (Netflix, Spotify, Claude, Amazon...) ou branco com logo colorido (Google, YouTube,
 * Airbnb...), é assim; onde é a cor da marca com logo branco (iFood, Vivo, Booking, Shopee...), é a cor da marca, às
 * vezes um tom mais fechado para o branco passar AA. Disco escuro some no fundo do app: `StoreDisc` põe borda
 * `colors.border`. A chave é o id do catálogo do app (`lib/brands.ts`). Banco com logo de imagem (Nubank, Inter,
 * Santander, Itaú, Bradesco, Caixa, Mercado Pago) não aparece aqui: usa o logo de `banks`. Marca sem glifo livre (99,
 * Claro, TIM, KaBuM!...) fica na cor aproximada da marca com ícone genérico e vale só como identificação.
 */
export interface BrandDisc {
	disc: string;
	glyph: string;
}

export const brandDiscs = {
	"99": { disc: "#FFC700", glyph: "#111111" },
	adobe: { disc: "#D91000", glyph: "#FFFFFF" },
	airbnb: { disc: "#FFFFFF", glyph: "#D92D43" },
	amazon: { disc: "#131A22", glyph: "#FF9900" },
	americanas: { disc: "#E60014", glyph: "#FFFFFF" },
	anthropic: { disc: "#141413", glyph: "#D97757" },
	apple: { disc: "#000000", glyph: "#FFFFFF" },
	booking: { disc: "#003A9A", glyph: "#FFFFFF" },
	centauro: { disc: "#D2232A", glyph: "#FFFFFF" },
	claro: { disc: "#DA291C", glyph: "#FFFFFF" },
	claude: { disc: "#141413", glyph: "#D97757" },
	disneyplus: { disc: "#113CCF", glyph: "#FFFFFF" },
	drogasil: { disc: "#00923F", glyph: "#111111" },
	github: { disc: "#0D1117", glyph: "#FFFFFF" },
	globoplay: { disc: "#FFFFFF", glyph: "#E32A3A" },
	google: { disc: "#FFFFFF", glyph: "#1A73E8" },
	googleone: { disc: "#FFFFFF", glyph: "#6A4FC4" },
	grok: { disc: "#000000", glyph: "#FFFFFF" },
	hostinger: { disc: "#673DE6", glyph: "#FFFFFF" },
	icloud: { disc: "#1670D0", glyph: "#FFFFFF" },
	ifood: { disc: "#E31C2B", glyph: "#FFFFFF" },
	kabum: { disc: "#FF6500", glyph: "#111111" },
	magalu: { disc: "#0086FF", glyph: "#111111" },
	max: { disc: "#002BE7", glyph: "#FFFFFF" },
	mercadolivre: { disc: "#FFE600", glyph: "#2D3277" },
	microsoft: { disc: "#FFFFFF", glyph: "#0078D4" },
	netflix: { disc: "#000000", glyph: "#F61A24" },
	openai: { disc: "#000000", glyph: "#FFFFFF" },
	paguemenos: { disc: "#005CA9", glyph: "#FFFFFF" },
	primevideo: { disc: "#0C75A5", glyph: "#FFFFFF" },
	raia: { disc: "#E4002B", glyph: "#FFFFFF" },
	rappi: { disc: "#FF441F", glyph: "#111111" },
	shein: { disc: "#FFFFFF", glyph: "#111111" },
	shopee: { disc: "#D13A1C", glyph: "#FFFFFF" },
	spotify: { disc: "#000000", glyph: "#1ED760" },
	steam: { disc: "#1B2838", glyph: "#FFFFFF" },
	tim: { disc: "#004691", glyph: "#FFFFFF" },
	uber: { disc: "#000000", glyph: "#FFFFFF" },
	vivo: { disc: "#660099", glyph: "#FFFFFF" },
	youtube: { disc: "#FFFFFF", glyph: "#E60000" },
} as const satisfies Record<string, BrandDisc>;

export type BrandDiscId = keyof typeof brandDiscs;
