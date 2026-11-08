import { describe, expect, it } from "vitest";
import { makePdf } from "./make-pdf.ts";
import { detectStatementFormat, parseStatement } from "./parse.ts";

const enc = (text: string) => new TextEncoder().encode(text);

describe("detectStatementFormat", () => {
	it("decide pelo conteúdo, não pela extensão", () => {
		expect(detectStatementFormat(makePdf([["x"]]), "extrato.pdf")).toBe("pdf");
		expect(detectStatementFormat(enc("OFXHEADER:100\n<OFX></OFX>"), "extrato.ofx")).toBe("ofx");
		expect(detectStatementFormat(enc("<OFX></OFX>"), "extrato.txt")).toBe("ofx");
		expect(detectStatementFormat(enc("a;b\n1;2"), "extrato.csv")).toBe("csv");
	});

	it("recusa extensão fora da lista, vazio e arquivo que mente", () => {
		expect(() => detectStatementFormat(enc("x"), "extrato.exe")).toThrow(/CSV, OFX ou PDF/);
		expect(() => detectStatementFormat(enc("x"), "semextensao")).toThrow(/CSV, OFX ou PDF/);
		expect(() => detectStatementFormat(new Uint8Array(), "a.csv")).toThrow(/vazio/);
		expect(() => detectStatementFormat(enc("texto"), "a.pdf")).toThrow(/PDF de verdade/);
		expect(() => detectStatementFormat(enc("a;b\n1;2"), "a.ofx")).toThrow(/OFX de verdade/);
		expect(() => detectStatementFormat(Uint8Array.from([1, 2, 0, 3]), "a.csv")).toThrow(/texto/);
	});

	it("um PDF renomeado para .csv continua sendo lido como PDF", () => {
		expect(detectStatementFormat(makePdf([["x"]]), "extrato.csv")).toBe("pdf");
	});
});

describe("parseStatement", () => {
	it("despacha por formato", async () => {
		const csv = await parseStatement(enc("Data;Descrição;Valor\n05/03/2026;X;-1,00"), "a.csv");
		expect(csv.status === "ok" && csv.format).toBe("csv");
		const ofx = await parseStatement(
			enc("<OFX><STMTTRN><DTPOSTED>20260305<TRNAMT>-1.00<FITID>1<MEMO>X</STMTTRN></OFX>"),
			"a.ofx",
		);
		expect(ofx.status === "ok" && ofx.items.length).toBe(1);
		const pdf = await parseStatement(
			makePdf([["Periodo 01/03/2026 a 31/03/2026", "05/03/2026 X -1,00"]]),
			"a.pdf",
		);
		expect(pdf.status === "ok" && pdf.items.length).toBe(1);
	});
});
