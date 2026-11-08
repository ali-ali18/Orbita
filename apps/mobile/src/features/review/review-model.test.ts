import { describe, expect, it } from "vitest";
import {
	confirmAllLabel,
	reviewBannerTitle,
	reviewIntro,
	reviewOrigin,
	reviewSourceIcon,
} from "./review-model.ts";

describe("textos da revisão", () => {
	it("um lançamento fala no singular", () => {
		expect(reviewIntro(1, false)).toBe(
			"1 lançamento chegou sozinho. Confira antes de entrar nos seus números.",
		);
		expect(reviewBannerTitle(1, false)).toBe("1 lançamento para revisar");
		expect(confirmAllLabel(1, false)).toBe("Confirmar este");
	});
	it("vários seguem a frase do Figma", () => {
		expect(reviewIntro(3, false)).toBe(
			"3 lançamentos chegaram sozinhos. Confira antes de entrarem nos seus números.",
		);
		expect(reviewBannerTitle(3, false)).toBe("3 lançamentos para revisar");
		expect(confirmAllLabel(3, false)).toBe("Confirmar os 3 sem dúvida");
	});
	it("quando a lista não coube, não promete que são só esses", () => {
		expect(reviewIntro(200, true)).toContain("Pelo menos 200");
		expect(reviewBannerTitle(200, true)).toBe("200 ou mais lançamentos para revisar");
		expect(confirmAllLabel(200, true)).toBe("Confirmar os 200 carregados");
	});
});

describe("origem", () => {
	it("notificação e extrato levam o nome do banco", () => {
		expect(reviewOrigin("notification", "Nubank")).toBe("Notificação do Nubank");
		expect(reviewOrigin("notification", null)).toBe("Notificação");
		expect(reviewOrigin("pluggy", "Inter")).toBe("Extrato do Inter");
		expect(reviewOrigin("receipt", "Inter")).toBe("Comprovante compartilhado");
		expect(reviewOrigin("import", null)).toBe("Arquivo importado");
		expect(reviewOrigin("manual", null)).toBe("Lançado à mão");
	});
	it("cada origem tem o ícone do Figma", () => {
		expect(reviewSourceIcon("notification")).toBe("notificacao");
		expect(reviewSourceIcon("receipt")).toBe("escanear");
		expect(reviewSourceIcon("pluggy")).toBe("banco");
	});
});
