/**
 * Disco de cada loja ou serviço que o app reconhece: cor de fundo (a da marca, ou branco quando a marca é preta ou
 * escura demais para o fundo do app) e a cor do glifo em cima, escolhida para passar AA (4,5:1) sobre o disco.
 * A chave é o id do catálogo do app (`lib/brands.ts`). Banco com logo de imagem (Nubank, Inter, Santander, Itaú,
 * Bradesco, Caixa, Mercado Pago) não aparece aqui: usa o logo de `banks`. Cores de marca sem logo livre (Amazon,
 * Mercado Livre, Claro…) são aproximadas e valem só como identificação.
 */
export interface BrandDisc {
	disc: string;
	glyph: string;
}

export const brandDiscs = {
	"99": { disc: "#FFC700", glyph: "#111111" },
	adobe: { disc: "#FA0F00", glyph: "#111111" },
	airbnb: { disc: "#FF5A5F", glyph: "#111111" },
	amazon: { disc: "#FF9900", glyph: "#111111" },
	americanas: { disc: "#E60014", glyph: "#FFFFFF" },
	anthropic: { disc: "#D97757", glyph: "#111111" },
	apple: { disc: "#FFFFFF", glyph: "#111111" },
	booking: { disc: "#003A9A", glyph: "#FFFFFF" },
	centauro: { disc: "#D2232A", glyph: "#FFFFFF" },
	claro: { disc: "#DA291C", glyph: "#FFFFFF" },
	claude: { disc: "#D97757", glyph: "#111111" },
	disneyplus: { disc: "#113CCF", glyph: "#FFFFFF" },
	drogasil: { disc: "#00923F", glyph: "#111111" },
	github: { disc: "#FFFFFF", glyph: "#181717" },
	globoplay: { disc: "#FFFFFF", glyph: "#E32A3A" },
	google: { disc: "#4285F4", glyph: "#111111" },
	googleone: { disc: "#8E75B2", glyph: "#111111" },
	grok: { disc: "#FFFFFF", glyph: "#111111" },
	hostinger: { disc: "#673DE6", glyph: "#FFFFFF" },
	icloud: { disc: "#3693F3", glyph: "#111111" },
	ifood: { disc: "#FFFFFF", glyph: "#E31C2B" },
	kabum: { disc: "#FF6500", glyph: "#111111" },
	magalu: { disc: "#0086FF", glyph: "#111111" },
	max: { disc: "#002BE7", glyph: "#FFFFFF" },
	mercadolivre: { disc: "#FFE600", glyph: "#111111" },
	microsoft: { disc: "#00A4EF", glyph: "#111111" },
	netflix: { disc: "#E50914", glyph: "#FFFFFF" },
	openai: { disc: "#10A37F", glyph: "#111111" },
	paguemenos: { disc: "#005CA9", glyph: "#FFFFFF" },
	primevideo: { disc: "#00A8E1", glyph: "#111111" },
	raia: { disc: "#E4002B", glyph: "#FFFFFF" },
	rappi: { disc: "#FF441F", glyph: "#111111" },
	shein: { disc: "#FFFFFF", glyph: "#111111" },
	shopee: { disc: "#EE4D2D", glyph: "#111111" },
	spotify: { disc: "#1ED760", glyph: "#111111" },
	steam: { disc: "#FFFFFF", glyph: "#1B2838" },
	tim: { disc: "#004691", glyph: "#FFFFFF" },
	uber: { disc: "#FFFFFF", glyph: "#111111" },
	vivo: { disc: "#660099", glyph: "#FFFFFF" },
	youtube: { disc: "#FF0000", glyph: "#111111" },
} as const satisfies Record<string, BrandDisc>;

export type BrandDiscId = keyof typeof brandDiscs;
