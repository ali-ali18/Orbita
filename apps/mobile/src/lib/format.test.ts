import { describe, expect, it } from "vitest";
import {
	dayMonth,
	formatWholeReais,
	greetingFor,
	HIDDEN_VALUE,
	maskValue,
	money,
	monthName,
	monthYear,
	percentOf,
	pluralDays,
	relativeDate,
} from "./format.ts";

describe("valores escondidos", () => {
	it("troca o dinheiro por bolinhas só quando escondido", () => {
		expect(maskValue("R$ 10,00", true)).toBe(HIDDEN_VALUE);
		expect(maskValue("R$ 10,00", false)).toBe("R$ 10,00");
		expect(money(128450, false)).toBe("R$ 1.284,50");
		expect(money(128450, true)).toBe("••••");
		expect(money(-4590, false)).toBe("−R$ 45,90");
	});
});

describe("formatWholeReais", () => {
	it("arredonda para reais cheios sem usar float", () => {
		expect(formatWholeReais(5349)).toBe("R$ 53");
		expect(formatWholeReais(5350)).toBe("R$ 54");
		expect(formatWholeReais(300000)).toBe("R$ 3.000");
		expect(formatWholeReais(0)).toBe("R$ 0");
		expect(formatWholeReais(-5350)).toBe("−R$ 54");
	});
});

describe("percentOf", () => {
	it("dá o percentual inteiro e protege contra total zero", () => {
		expect(percentOf(171550, 300000)).toBe(57);
		expect(percentOf(1, 0)).toBe(0);
		expect(percentOf(0, 100)).toBe(0);
	});
});

describe("datas", () => {
	it("nome do mês", () => {
		expect(monthName("2026-11")).toBe("Novembro");
		expect(monthName("2026-01")).toBe("Janeiro");
	});
	it("hoje, ontem e dia curto, inclusive na virada de mês", () => {
		expect(relativeDate("2026-11-06", "2026-11-06")).toBe("Hoje");
		expect(relativeDate("2026-11-05", "2026-11-06")).toBe("Ontem");
		expect(relativeDate("2026-10-31", "2026-11-01")).toBe("Ontem");
		expect(relativeDate("2026-10-03", "2026-11-06")).toBe("3 out");
	});
	it("saudação e plural", () => {
		expect(greetingFor(3)).toBe("Boa noite");
		expect(greetingFor(9)).toBe("Bom dia");
		expect(greetingFor(15)).toBe("Boa tarde");
		expect(greetingFor(21)).toBe("Boa noite");
		expect(pluralDays(1)).toBe("1 dia");
		expect(pluralDays(3)).toBe("3 dias");
	});
});

describe("datas de fatura", () => {
	it("dayMonth tira o zero do dia e abrevia o mês", () => {
		expect(dayMonth("2026-11-07")).toBe("7 de nov");
		expect(dayMonth("2026-10-31")).toBe("31 de out");
	});
	it("monthYear escreve o mês por extenso em minúsculas", () => {
		expect(monthYear("2027-08")).toBe("agosto de 2027");
	});
});
