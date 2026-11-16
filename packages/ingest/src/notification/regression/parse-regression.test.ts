import { describe, expect, it } from "vitest";
import { parseNotification } from "../parse.ts";
import { corpus } from "./corpus.ts";
import { parseNotification as parseMain } from "./parse-main.ts";

/*
 * Regressão contra o parser de origin/main (cópia congelada em `parse-main.ts`) sobre um corpus de textos inventados
 * (`corpus.ts`): bancos, lojas com palavra de oferta no nome, Pix, TED, boleto, débito, fatura, parcelas, vários valores.
 * Regras:
 *  - o que main lia como compra/Pix continua lido, com os MESMOS campos (exceto a loja do formato novo do Santander,
 *    que main lia errado);
 *  - nada com R$ que main entendia ou mandava ao dono vira descarte; a oferta só é OCULTA ("promo": o chamador guarda);
 *  - o que main não lia nunca passa a ser lançamento sem ser um dos formatos novos (Santander, cancelamento).
 */

type Any = ReturnType<typeof parseNotification>;
const unique = (() => {
	const seen = new Set<string>();
	return corpus.filter((c) => {
		const key = `${c.app}|${c.title}|${c.text}`.replace(/R\$ ?[\d.,]+/g, "R$V");
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
})();
const hasMoney = (c: { title: string; text: string }) => /R\$/i.test(`${c.title} ${c.text}`);
const SANTANDER_NEW = /compra no cartão final \d{4}, (?:de|no valor de) R\$/i;

describe("regressão do parser contra origin/main", () => {
	const rows = unique.map((c) => {
		const input = { app: c.app as never, title: c.title, text: c.text };
		return { c, main: parseMain(input) as Any, cur: parseNotification(input) };
	});

	it("o corpus é grande", () => {
		expect(rows.length).toBeGreaterThan(400);
	});

	it("tudo que main lia (parsed) continua lido, com os mesmos campos", () => {
		const diffs = rows.filter(
			({ main, cur }) =>
				main.outcome === "parsed" &&
				(cur.outcome !== "parsed" ||
					JSON.stringify({ ...cur.data, merchant: 0 }) !== JSON.stringify({ ...main.data, merchant: 0 })),
		);
		expect(
			diffs.map(
				({ c, main, cur }) => `${c.title} | ${c.text} :: ${JSON.stringify(main)} -> ${JSON.stringify(cur)}`,
			),
		).toEqual([]);
	});

	it("a loja só muda no formato novo do Santander (que main lia errado)", () => {
		const diffs = rows.filter(
			({ c, main, cur }) =>
				main.outcome === "parsed" &&
				cur.outcome === "parsed" &&
				main.data.merchant !== cur.data.merchant &&
				!SANTANDER_NEW.test(c.text),
		);
		expect(diffs.map(({ c }) => c.text)).toEqual([]);
	});

	it("nada com R$ vira descarte: só parsed, unrecognized, cancelamento ou oferta oculta (promo)", () => {
		const lost = rows.filter(({ c, main, cur }) => {
			if (!hasMoney(c) || cur.outcome !== "skip") return false;
			// Descartes que main já fazia (recusada, aviso de fatura/limite) continuam iguais.
			if (main.outcome === "skip") return cur.reason !== main.reason && cur.reason !== "promo";
			return cur.reason !== "promo";
		});
		expect(
			lost.map(({ c, main, cur }) => `${c.text} :: ${JSON.stringify(main)} -> ${JSON.stringify(cur)}`),
		).toEqual([]);
	});

	it("oferta oculta só vem do que main NÃO lia como compra/Pix", () => {
		const hidden = rows.filter(({ cur }) => cur.outcome === "skip" && cur.reason === "promo");
		expect(hidden.length).toBeGreaterThan(0);
		expect(hidden.filter(({ main }) => main.outcome === "parsed").map(({ c }) => c.text)).toEqual([]);
	});

	it("o que main não lia só passa a ser lido nos formatos novos do Santander", () => {
		const added = rows.filter(
			({ c, main, cur }) =>
				main.outcome !== "parsed" && cur.outcome === "parsed" && !SANTANDER_NEW.test(c.text),
		);
		expect(added.map(({ c }) => c.text)).toEqual([]);
	});

	it("limite e fatura fechada continuam avisos que somem (info), como em main", () => {
		for (const text of [
			"Limite pré-aprovado de R$ 5.000 para você",
			"Seu limite foi aumentado para R$ 2.500,00",
			"Sua fatura fechou em R$ 830,10 e vence dia 17",
		]) {
			expect(parseNotification({ app: "nubank", title: "", text }), text).toEqual(
				parseMain({ app: "nubank", title: "", text }),
			);
		}
	});
});
