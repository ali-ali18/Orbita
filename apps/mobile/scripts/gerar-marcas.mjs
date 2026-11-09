// Gera `src/ui/brand-glyphs.ts` a partir de duas fontes locais, embutindo só os glifos usados como caminho SVG
// (viewBox 24 × 24). Nada é baixado em runtime. Uso: `pnpm --filter @orbita/mobile marcas`.
//  1. pacote `simple-icons` (CC0-1.0, devDependency);
//  2. SVGs do theSVG (thesvg.org) guardados em `assets/brands/thesvg/<id>.svg`, validados e reduzidos a um só caminho
//     (ver assets/brands/NOTICE.txt). Têm precedência quando o id existe nas duas fontes.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import * as si from "simple-icons";
import svgpath from "svgpath";

/** Id da marca no app -> slug do Simple Icons. Marca fora desta lista e de `assets/brands/thesvg` não tem glifo livre. */
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

/** Só estes elementos entram num SVG do theSVG; script, href, imagem, estilo e afins derrubam a geração. */
const ALLOWED_TAGS = new Set([
	"svg",
	"path",
	"circle",
	"g",
	"defs",
	"clipPath",
	"rect",
	"title",
	"linearGradient",
	"radialGradient",
	"stop",
]);
const FORBIDDEN =
	/<script|href\s*=|<image|<foreignObject|<use\b|<style|javascript:|\son[a-z]+\s*=|<!ENTITY|<!DOCTYPE/i;
const BOX = 24;
const PAD = 1;

function assertPlainSvg(id, svg) {
	if (FORBIDDEN.test(svg))
		throw new Error(`thesvg/${id}.svg: conteúdo não permitido (script, href, imagem, estilo…)`);
	for (const [, tag] of svg.matchAll(/<([A-Za-z][\w:-]*)/g)) {
		if (!ALLOWED_TAGS.has(tag)) throw new Error(`thesvg/${id}.svg: elemento <${tag}> não permitido`);
	}
}

/** Caixa envolvente do caminho, amostrando as curvas (basta para centrar e escalar o glifo). */
function bounds(d) {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	const add = (x, y) => {
		minX = Math.min(minX, x);
		maxX = Math.max(maxX, x);
		minY = Math.min(minY, y);
		maxY = Math.max(maxY, y);
	};
	let cx = 0;
	let cy = 0;
	let sx = 0;
	let sy = 0;
	const STEPS = 24;
	svgpath(d)
		.abs()
		.unarc()
		.unshort()
		.iterate((seg) => {
			const [c, ...v] = seg;
			if (c === "M" || c === "L") {
				cx = v[0];
				cy = v[1];
				if (c === "M") {
					sx = cx;
					sy = cy;
				}
				add(cx, cy);
			} else if (c === "H") {
				cx = v[0];
				add(cx, cy);
			} else if (c === "V") {
				cy = v[0];
				add(cx, cy);
			} else if (c === "C" || c === "Q") {
				const pts = [[cx, cy]];
				for (let i = 0; i < v.length; i += 2) pts.push([v[i], v[i + 1]]);
				for (let k = 1; k <= STEPS; k += 1) {
					const u = k / STEPS;
					let ps = pts;
					while (ps.length > 1) {
						const prev = ps;
						ps = prev
							.slice(1)
							.map((p, i) => [prev[i][0] + (p[0] - prev[i][0]) * u, prev[i][1] + (p[1] - prev[i][1]) * u]);
					}
					add(ps[0][0], ps[0][1]);
				}
				cx = v[v.length - 2];
				cy = v[v.length - 1];
			} else if (c === "Z") {
				cx = sx;
				cy = sy;
			}
		});
	return { minX, minY, maxX, maxY };
}

/** Todos os `d` do SVG num só caminho, centrado e escalado para caber em 24 × 24 (com 1 de margem). */
function glyphFromSvg(id, svg) {
	assertPlainSvg(id, svg);
	const ds = [...svg.matchAll(/<path\b[^>]*?\sd="([^"]+)"/g)].map((m) => m[1]);
	if (ds.length === 0) throw new Error(`thesvg/${id}.svg: sem <path>`);
	const joined = ds.join(" ");
	const b = bounds(joined);
	const w = b.maxX - b.minX;
	const h = b.maxY - b.minY;
	const k = (BOX - 2 * PAD) / Math.max(w, h);
	const dx = (BOX - w * k) / 2 - b.minX * k;
	const dy = (BOX - h * k) / 2 - b.minY * k;
	return svgpath(joined).abs().scale(k).translate(dx, dy).round(2).toString();
}

const bySlug = new Map(Object.values(si).map((icon) => [icon.slug, icon]));
const glyphs = new Map(
	Object.entries(USED).map(([id, slug]) => {
		const icon = bySlug.get(slug);
		if (!icon) throw new Error(`Simple Icons não tem "${slug}"`);
		return [id, icon.path];
	}),
);
const thesvgDir = new URL("../assets/brands/thesvg/", import.meta.url);
for (const file of readdirSync(thesvgDir)
	.filter((f) => f.endsWith(".svg"))
	.sort()) {
	glyphs.set(
		file.slice(0, -4),
		glyphFromSvg(file.slice(0, -4), readFileSync(new URL(file, thesvgDir), "utf8")),
	);
}
const lines = [...glyphs]
	.sort(([a], [b]) => a.localeCompare(b))
	.map(([id, path]) => `\t${JSON.stringify(id)}: ${JSON.stringify(path)},`);

const out = `// GERADO por scripts/gerar-marcas.mjs a partir do pacote simple-icons (CC0-1.0) e dos SVGs do theSVG. Não edite à mão.
// Glifos monocromáticos em viewBox 24 × 24; as marcas são dos respectivos donos (ver assets/brands/NOTICE.txt).
export const brandGlyphs: Readonly<Record<string, string>> = {
${lines.join("\n")}
};
`;
writeFileSync(new URL("../src/ui/brand-glyphs.ts", import.meta.url), out);
console.log(`${lines.length} glifos`);
