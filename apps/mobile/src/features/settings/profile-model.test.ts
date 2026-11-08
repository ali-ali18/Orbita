import { describe, expect, it } from "vitest";
import {
	avatarInitial,
	firstName,
	greetWithName,
	hello,
	parseDeviceName,
	parseDisplayName,
} from "./profile-model.ts";

describe("nome do dono", () => {
	it("tira espaços das pontas", () => {
		expect(parseDisplayName("  Alisson Camargo ")).toEqual({ ok: true, value: "Alisson Camargo" });
	});
	it("recusa vazio e longo com a mensagem do servidor", () => {
		expect(parseDisplayName("   ")).toEqual({ ok: false, message: "Informe o nome." });
		expect(parseDisplayName("x".repeat(41))).toEqual({ ok: false, message: "O nome tem até 40 letras." });
		expect(parseDisplayName("x".repeat(40)).ok).toBe(true);
	});
});

describe("nome do aparelho", () => {
	it("valida de 1 a 60 letras", () => {
		expect(parseDeviceName(" Galaxy S24 ")).toEqual({ ok: true, value: "Galaxy S24" });
		expect(parseDeviceName("")).toEqual({ ok: false, message: "Informe o nome do aparelho." });
		expect(parseDeviceName("x".repeat(61)).ok).toBe(false);
	});
});

describe("cumprimento", () => {
	it("usa só a primeira palavra do nome", () => {
		expect(firstName("Alisson Camargo")).toBe("Alisson");
		expect(firstName("  ")).toBeNull();
		expect(firstName(null)).toBeNull();
	});
	it("acrescenta o nome ao cumprimento, quando existe", () => {
		expect(greetWithName("Boa tarde", "Alisson Camargo")).toBe("Boa tarde, Alisson");
		expect(greetWithName("Boa tarde", null)).toBe("Boa tarde");
		expect(hello("Ana")).toBe("Olá, Ana");
		expect(hello(undefined)).toBe("Olá");
	});
	it("a letra do avatar é a inicial do nome, com acento e em maiúscula", () => {
		expect(avatarInitial("alisson")).toBe("A");
		expect(avatarInitial("Érica")).toBe("É");
		expect(avatarInitial(null)).toBe("V");
		expect(avatarInitial("  ", "?")).toBe("?");
	});
});
