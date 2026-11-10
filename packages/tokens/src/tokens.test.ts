import { describe, expect, it } from "vitest";
import {
	agents,
	banks,
	brandDiscs,
	categoryColor,
	chart,
	chartSeries,
	colors,
	contrastRatio,
	defaultCategoryColor,
	issuerBand,
	issuerFallback,
	issuers,
	layout,
	radius,
	readableTextOn,
	spacing,
	text,
} from "./index.ts";

const HEX = /^#[0-9A-F]{6}$/;

describe("tokens", () => {
	it("toda cor é hex de 6 dígitos em maiúsculas", () => {
		const all = [
			...Object.values(colors),
			...Object.values(chart),
			...Object.values(banks),
			...chartSeries,
			...Object.values(agents).flatMap((a) => [a.color, a.tint]),
		];
		for (const c of all) expect(c).toMatch(HEX);
	});

	it("o verde de dinheiro que entra passa AA (4.5:1) sobre o fundo e o card", () => {
		const lum = (hex: string) => {
			const [r, g, b] = [1, 3, 5].map((i) => {
				const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
				return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
			}) as [number, number, number];
			return 0.2126 * r + 0.7152 * g + 0.0722 * b;
		};
		const ratio = (a: string, b: string) => {
			const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
			return (hi + 0.05) / (lo + 0.05);
		};
		for (const bg of [colors.background, colors.surface, colors.surface2]) {
			expect(ratio(colors.positive, bg)).toBeGreaterThanOrEqual(4.5);
			expect(ratio(colors.danger, bg)).toBeGreaterThanOrEqual(4.5);
			expect(ratio(colors.warning, bg)).toBeGreaterThanOrEqual(4.5);
		}
	});

	it("a série do gráfico tem uma cor por categoria padrão, nesta ordem", () => {
		expect([...chartSeries]).toEqual([
			"#3987E5",
			"#D95926",
			"#199E70",
			"#C98500",
			"#D55181",
			"#7C5CFF",
			"#2EC4D6",
			"#E23D3D",
			"#8FBF3F",
			"#7AA2FF",
		]);
		expect(new Set(chartSeries).size).toBe(chartSeries.length);
	});

	it("toda categoria padrão tem cor própria, e um nome novo também", () => {
		const valid = new Set<string>(Object.values(chart));
		for (const c of Object.values(defaultCategoryColor)) expect(valid.has(c)).toBe(true);
		expect(new Set(Object.values(defaultCategoryColor)).size).toBe(10);
		expect(defaultCategoryColor.outros).not.toBe(chart.other);
		expect(categoryColor({ slug: "moradia", chartSlot: null })).toBe(chart.violet);
		expect(categoryColor({ slug: "mercado", chartSlot: 3 })).toBe(chartSeries[3]);
		expect(valid.has(categoryColor({ slug: "pets", chartSlot: null }))).toBe(true);
	});

	it("o espaçamento é crescente e múltiplo de 4", () => {
		const v = Object.values(spacing);
		expect(v).toEqual([...v].sort((a, b) => a - b));
		for (const n of v) expect(n % 4).toBe(0);
	});

	it("as medidas de layout são múltiplos de 4 e o alvo de toque tem pelo menos 44", () => {
		for (const n of Object.values(layout)) expect(n % 4).toBe(0);
		expect(layout.touchTarget).toBeGreaterThanOrEqual(44);
	});

	it("os raios crescem de sm até card e a pílula é o maior", () => {
		const { pill, ...rest } = radius;
		expect(radius.sm).toBeLessThan(radius.inner);
		expect(radius.inner).toBeLessThan(radius.group);
		expect(radius.group).toBeLessThan(radius.block);
		expect(radius.block).toBeLessThan(radius.card);
		for (const n of Object.values(rest)) expect(n).toBeLessThan(pill);
	});

	it("a altura de linha nunca é menor que o tamanho da fonte", () => {
		for (const s of Object.values(text)) expect(s.lineHeight).toBeGreaterThanOrEqual(s.fontSize);
	});

	it("o tom do cartão de cada agente é a cor dele a 14% sobre o preto", () => {
		const channel = (hex: string, i: number) => Number.parseInt(hex.slice(i, i + 2), 16);
		for (const key of [
			"vigia",
			"fechamento",
			"metas",
			"caca_assinatura",
			"cofrinho",
			"economia",
			"custom",
		] as const) {
			const { color, tint } = agents[key];
			for (const i of [1, 3, 5]) {
				const expected = Math.round(channel(color, i) * 0.14);
				expect(Math.abs(channel(tint, i) - expected)).toBeLessThanOrEqual(1);
			}
		}
	});
});

describe("issuers", () => {
	it("toda faixa é hex e o texto passa AA (4,5:1) sobre ela", () => {
		for (const { band, text: ink } of [...Object.values(issuers), issuerFallback]) {
			expect(band).toMatch(HEX);
			expect(ink).toMatch(HEX);
			expect(contrastRatio(band, ink)).toBeGreaterThanOrEqual(4.5);
		}
	});
	it("busca pelo ISPB e cai no cinza neutro", () => {
		expect(issuerBand("90400888").band).toBe("#EC0000");
		expect(issuerBand("10573521")).toEqual({ band: "#FFE600", text: "#111111" });
		expect(issuerBand("99999999")).toEqual(issuerFallback);
		expect(issuerBand(null)).toEqual(issuerFallback);
	});
	it("escolhe texto preto no amarelo e branco no roxo", () => {
		expect(readableTextOn("#FFE600")).toBe("#111111");
		expect(readableTextOn("#820AD1")).toBe("#FFFFFF");
	});
});

describe("brandDiscs", () => {
	it("todo disco é hex e o glifo passa AA (4,5:1) sobre ele", () => {
		for (const { disc, glyph } of Object.values(brandDiscs)) {
			expect(disc).toMatch(HEX);
			expect(glyph).toMatch(HEX);
			expect(contrastRatio(disc, glyph)).toBeGreaterThanOrEqual(4.5);
		}
	});

	it("imita o ícone de app: escuro com logo colorido, branco com logo colorido, cor da marca com logo branco", () => {
		expect(brandDiscs.netflix.disc).toBe("#000000");
		expect(brandDiscs.spotify.disc).toBe("#000000");
		expect(brandDiscs.claude.disc).toBe(brandDiscs.anthropic.disc);
		expect(brandDiscs.youtube.disc).toBe("#FFFFFF");
		expect(brandDiscs.ifood.glyph).toBe("#FFFFFF");
		expect(brandDiscs.ifood.disc).not.toBe("#FFFFFF");
		expect(brandDiscs.uber).toEqual({ disc: "#000000", glyph: "#FFFFFF" });
	});
});
