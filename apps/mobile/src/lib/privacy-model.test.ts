import { describe, expect, it } from "vitest";
import { initialHidden } from "./privacy-model.ts";

describe("estado inicial do olho", () => {
	it("esconder ao abrir manda, mesmo que da última vez estivesse visível", () => {
		expect(initialHidden("0", "1")).toBe(true);
		expect(initialHidden(null, "1")).toBe(true);
	});
	it("sem a preferência, volta como ficou", () => {
		expect(initialHidden("1", null)).toBe(true);
		expect(initialHidden("0", "0")).toBe(false);
		expect(initialHidden(null, null)).toBe(false);
	});
});
