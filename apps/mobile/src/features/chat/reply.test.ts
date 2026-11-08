import { describe, expect, it } from "vitest";
import { answerChat, type ChatFacts } from "./reply.ts";

const facts: ChatFacts = {
	monthName: "novembro",
	spentCents: 33678,
	incomeCents: 13,
	categories: [
		{
			id: "del",
			name: "Delivery",
			slug: "delivery",
			spentCents: 4890,
			limitCents: 15000,
			remainingCents: 10110,
		},
		{
			id: "out",
			name: "Outros",
			slug: "outros",
			spentCents: 0,
			limitCents: null,
			remainingCents: null,
		},
	],
	sources: [{ id: "nu", name: "Nubank", type: "card" }],
	safeToSpend: { availableCents: 196322 },
	projectionCents: 190000,
};

describe("answerChat", () => {
	it("lê o gasto da categoria que o resumo já tem", () => {
		const reply = answerChat("Quanto gastei com delivery?", facts);
		expect(reply).toEqual({
			type: "text",
			text: "Delivery está em R$ 48,90 este mês. O limite é R$ 150,00 e ainda cabe R$ 101,10.",
		});
	});

	it("fecha o mês com o que dá pra gastar e a projeção, sem conta nova", () => {
		const reply = answerChat("Como fecha o mês?", facts);
		expect(reply.type).toBe("month");
		if (reply.type !== "month") return;
		expect(reply.text).toBe(
			"Ainda dá pra gastar R$ 1.963,22 em novembro. A projeção de gasto é R$ 1.900,00.",
		);
		expect(reply.rows.map((row) => row.cents)).toEqual([13, 33678, 190000]);
	});

	it("prepara o lançamento quando a frase tem valor, lugar e conta", () => {
		expect(answerChat("gastei 46,90 no ifood no nubank", facts)).toEqual({
			type: "launch",
			amountCents: 4690,
			description: "iFood",
			categoryId: "del",
			categoryName: "Delivery",
			source: facts.sources[0],
		});
	});

	it("pede a conta quando o valor não diz de onde saiu", () => {
		expect(answerChat("gastei 46,90 no ifood", facts).type).toBe("text");
	});

	it("não inventa leitura de comprovante", () => {
		expect(answerChat("Ler um comprovante", facts).type).toBe("text");
	});
});
