import { subscriptionBrand } from "@orbita/core";
import { friendlyMerchantName } from "@orbita/shared";
import type { BrandDiscId } from "@orbita/tokens";
import type { IconName } from "../ui/icons.tsx";
import type { BankLogoKey } from "./bank-logos.ts";

/*
 * Catálogo local de lojas e serviços frequentes, para pôr a marca no disco do lançamento e da assinatura no lugar do
 * ícone da categoria. Tudo local: glifos em `ui/brand-glyphs.ts` (Simple Icons, CC0) e logos de banco já empacotados.
 * Função pura, sem rede.
 */

interface BrandBase {
	id: string;
	/**
	 * Como a marca aparece no texto do estabelecimento, já sem acento nem maiúsculas e sem espaços (as janelas de 1 a 3
	 * palavras são coladas: "pague menos" casa a chave "paguemenos"). Casa a palavra inteira; `*` no fim aceita
	 * qualquer sufixo ("uber*" casa "uberrides"). Marca curta ou comum não leva `*` ("tim", "inter", "99").
	 */
	keys: readonly string[];
}

export type Brand =
	| (BrandBase & { kind: "bank"; logo: BankLogoKey })
	| (BrandBase & { kind: "disc"; id: BrandDiscId; icon: IconName });

const bank = (id: string, logo: BankLogoKey, ...keys: string[]): Brand => ({ kind: "bank", id, logo, keys });
/** `icon` é o ícone no disco quando a marca não tem glifo livre (ver `hasGlyph` em ui/BrandDisc.tsx). */
const disc = (id: BrandDiscId, icon: IconName, ...keys: string[]): Brand => ({
	kind: "disc",
	id,
	icon,
	keys,
});

/** Ordem importa: a primeira marca que casa vence (Google One antes de Google; Prime Video antes de Amazon). */
export const BRANDS: readonly Brand[] = [
	disc("spotify", "assinatura", "spotify*"),
	disc("googleone", "assinatura", "googleone*", "googlegemini*", "gemini"),
	disc("youtube", "assinatura", "youtube*", "youtub"),
	disc("google", "assinatura", "google", "googleplay", "googlebrasil"),
	disc("netflix", "assinatura", "netflix*"),
	disc("primevideo", "reproduzir", "primevideo*", "amazonprime*", "amazonmusic*"),
	disc("amazon", "compras", "amazon*", "amzn*"),
	disc("icloud", "assinatura", "icloud*", "appleservices"),
	disc("apple", "assinatura", "apple", "applecombill", "applemusic", "appletv", "applecom"),
	disc("uber", "transporte", "uber", "uberrides", "ubertrip", "ubereats", "uberbr"),
	disc("99", "transporte", "99", "99pop", "99food", "99taxi", "99app", "99tecnologia"),
	disc("ifood", "comida", "ifood*"),
	disc("rappi", "comida", "rappi*"),
	bank("mercadopago", "10573521", "mercadopago*"),
	disc("mercadolivre", "compras", "mercadolivre*", "mercadolibre*"),
	disc("kabum", "compras", "kabum*"),
	disc("centauro", "compras", "centauro*"),
	disc("steam", "lazer", "steam*", "steampowered"),
	disc("hostinger", "codigo", "hostinger*"),
	disc("vivo", "celular", "vivo", "telefonicabrasil"),
	disc("claro", "celular", "claro", "clarosa", "claronet"),
	disc("tim", "celular", "tim", "timbrasil", "timcelular"),
	bank("nubank", "18236120", "nubank*", "nupagamentos"),
	bank("inter", "00416968", "inter", "bancointer"),
	bank("santander", "90400888", "santander*"),
	bank("itau", "60701190", "itau*"),
	bank("bradesco", "60746948", "bradesco*"),
	bank("caixa", "00360305", "caixaeconomica*", "cef"),
	disc("shopee", "compras", "shopee*"),
	disc("shein", "compras", "shein*"),
	disc("magalu", "compras", "magalu*", "magazineluiza*"),
	disc("americanas", "compras", "americanas*", "lojasamericanas*"),
	disc("airbnb", "aviao", "airbnb*"),
	disc("booking", "aviao", "booking*"),
	disc("openai", "brilho", "openai*", "chatgpt*", "chatgp"),
	disc("anthropic", "brilho", "anthropic*"),
	disc("claude", "brilho", "claude*"),
	disc("grok", "brilho", "grok*", "xai", "xaillc"),
	disc("github", "codigo", "github*"),
	disc("microsoft", "monitor", "microsoft*", "msft*", "xbox*"),
	disc("adobe", "foto", "adobe*"),
	disc("disneyplus", "reproduzir", "disneyplus*", "disney"),
	disc("max", "reproduzir", "hbomax*", "hbo"),
	disc("globoplay", "reproduzir", "globoplay*"),
	disc("drogasil", "saude", "drogasil*"),
	disc("raia", "saude", "raia", "drogaraia*", "drogariaraia"),
	disc("paguemenos", "saude", "paguemenos*"),
];

const plain = (text: string): string => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const tokensOf = (text: string): string[] =>
	plain(text)
		.split(/[^a-z0-9]+/)
		.filter((t) => t !== "");

/** Janelas de 1 a 3 palavras coladas ("pague", "menos", "paguemenos"…), na ordem em que aparecem. */
function windows(tokens: readonly string[]): string[] {
	const out: string[] = [];
	for (let i = 0; i < tokens.length; i += 1) {
		let joined = "";
		for (let n = 0; n < 3 && i + n < tokens.length; n += 1) {
			joined += tokens[i + n];
			out.push(joined);
		}
	}
	return out;
}

const keyMatches = (key: string, candidate: string): boolean =>
	key.endsWith("*") ? candidate.startsWith(key.slice(0, -1)) : candidate === key;

function firstBrand(candidates: readonly string[]): Brand | null {
	if (candidates.length === 0) return null;
	for (const brand of BRANDS) {
		if (brand.keys.some((key) => candidates.some((c) => keyMatches(key, c)))) return brand;
	}
	return null;
}

/**
 * A marca de uma loja ou serviço a partir do texto do banco ("DL*Spotify P48CE", "MLP KABUM-KABUM", "CONTA VIVO"),
 * ou `null`. Primeiro tenta a marca de assinatura do core (que já separa YouTube de Google One e entende o Google
 * Play); depois procura o nome limpo do estabelecimento palavra por palavra. Aceita vários textos (descrição e
 * estabelecimento): o primeiro que reconhece vence.
 */
export function brandOf(...texts: Array<string | null | undefined>): Brand | null {
	for (const text of texts) {
		if (!text) continue;
		const byService = firstBrand(windows(tokensOf(subscriptionBrand(text))).slice(0, 1));
		if (byService) return byService;
		const byName = firstBrand(windows(tokensOf(friendlyMerchantName(text))));
		if (byName) return byName;
	}
	return null;
}
