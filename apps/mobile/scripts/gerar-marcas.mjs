// Gera `src/ui/brand-glyphs.ts` a partir do pacote `simple-icons` (CC0-1.0, devDependency): só os glifos usados,
// embutidos como caminho SVG (viewBox 24 × 24). Nada é baixado em runtime. Uso: `pnpm --filter @orbita/mobile marcas`.
import { writeFileSync } from "node:fs";
import * as si from "simple-icons";

/** Id da marca no app -> slug do Simple Icons. Marca fora desta lista não tem glifo livre (ver NOTICE). */
const USED = {
	spotify: "spotify",
	google: "google",
	googleone: "googlegemini",
	youtube: "youtube",
	netflix: "netflix",
	apple: "apple",
	icloud: "icloud",
	uber: "uber",
	ifood: "ifood",
	steam: "steam",
	hostinger: "hostinger",
	vivo: "vivo",
	shopee: "shopee",
	airbnb: "airbnb",
	booking: "bookingdotcom",
	anthropic: "anthropic",
	claude: "claude",
	github: "github",
	max: "max",
};

const bySlug = new Map(Object.values(si).map((icon) => [icon.slug, icon]));
const lines = Object.entries(USED).map(([id, slug]) => {
	const icon = bySlug.get(slug);
	if (!icon) throw new Error(`Simple Icons não tem "${slug}"`);
	return `\t${JSON.stringify(id)}: ${JSON.stringify(icon.path)},`;
});

const out = `// GERADO por scripts/gerar-marcas.mjs a partir do pacote simple-icons (CC0-1.0). Não edite à mão.
// Glifos monocromáticos em viewBox 24 × 24; as marcas são dos respectivos donos (ver assets/brands/NOTICE.txt).
export const brandGlyphs: Readonly<Record<string, string>> = {
${lines.join("\n")}
};
`;
writeFileSync(new URL("../src/ui/brand-glyphs.ts", import.meta.url), out);
console.log(`${lines.length} glifos`);
