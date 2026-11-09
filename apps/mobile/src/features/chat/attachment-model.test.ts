import { ATTACHMENT_MAX_BYTES } from "@orbita/shared";
import { describe, expect, it } from "vitest";
import {
	bytesToBase64,
	canSend,
	checkAttachment,
	checkPickedPdf,
	isPdf,
	shortName,
	userBubbleText,
} from "./attachment-model.ts";
import { dictationErrorMessage, mergeDictation, transcriptOf } from "./dictation-model.ts";

describe("PDF escolhido", () => {
	it("reconhece pelo tipo ou, sem tipo, pela extensão", () => {
		expect(isPdf({ mimeType: "application/pdf" })).toBe(true);
		expect(isPdf({ mimeType: null, name: "Nota.PDF" })).toBe(true);
		expect(isPdf({ mimeType: "image/png", name: "a.pdf" })).toBe(false);
		expect(isPdf({ name: "planilha.xlsx" })).toBe(false);
	});

	it("recusa tipo errado e arquivo acima de 5 MB, com mensagem em pt-BR", () => {
		expect(checkPickedPdf({ mimeType: "application/pdf", size: 1000 })).toBeNull();
		expect(checkPickedPdf({ mimeType: "application/pdf", size: ATTACHMENT_MAX_BYTES })).toBeNull();
		expect(checkPickedPdf({ mimeType: "application/pdf", size: ATTACHMENT_MAX_BYTES + 1 })).toBe(
			"O anexo passa de 5 MB. Escolha um arquivo menor.",
		);
		expect(checkPickedPdf({ mimeType: "text/plain", name: "a.txt" })).toBe(
			"Só aceito foto (JPEG, PNG ou WebP) e PDF.",
		);
		expect(checkPickedPdf({ name: "sem-tamanho.pdf" })).toBeNull();
	});
});

describe("anexo em base64", () => {
	it("codifica bytes em pedaços e bate com o base64 de referência", () => {
		const bytes = new Uint8Array(100_000).map((_, i) => i % 251);
		expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
		expect(bytesToBase64(new Uint8Array([]))).toBe("");
	});

	it("usa as mesmas regras do servidor", () => {
		const ok = Buffer.from("%PDF-1.7 teste").toString("base64");
		expect(checkAttachment({ mediaType: "application/pdf", data: ok })).toBeNull();
		expect(checkAttachment({ mediaType: "image/gif" as never, data: ok })).toBe(
			"Só aceito foto (JPEG, PNG ou WebP) e PDF.",
		);
		const big = Buffer.alloc(ATTACHMENT_MAX_BYTES + 1).toString("base64");
		expect(checkAttachment({ mediaType: "image/jpeg", data: big })).toBe(
			"O anexo passa de 5 MB. Escolha um arquivo menor.",
		);
		expect(checkAttachment({ mediaType: "image/jpeg", data: "" })).toBe("Anexo vazio.");
	});
});

describe("chip e envio", () => {
	it("encurta o nome mantendo a extensão", () => {
		expect(shortName("nota.pdf")).toBe("nota.pdf");
		const long = shortName("comprovante-de-pagamento-novembro-2026.pdf");
		expect(long.length).toBeLessThanOrEqual(24);
		expect(long.endsWith(".pdf")).toBe(true);
		expect(long).toContain("…");
		expect(shortName("   ")).toBe("arquivo");
	});

	it("a fala do dono leva o marcador do anexo, como no histórico do servidor", () => {
		expect(userBubbleText("  lança este ", 1)).toBe("lança este\n📎 anexo");
		expect(userBubbleText("", 1)).toBe("📎 anexo");
		expect(userBubbleText(" oi ", 0)).toBe("oi");
	});

	it("envia com texto ou com anexo, nunca vazio nem ocupado", () => {
		expect(canSend("", false, false)).toBe(false);
		expect(canSend("  ", false, false)).toBe(false);
		expect(canSend("oi", false, false)).toBe(true);
		expect(canSend("", true, false)).toBe(true);
		expect(canSend("oi", true, true)).toBe(false);
	});
});

describe("ditado", () => {
	it("junta o que já estava digitado com a fala", () => {
		expect(mergeDictation("", "gastei vinte reais")).toBe("gastei vinte reais");
		expect(mergeDictation("Almoço", "vinte reais")).toBe("Almoço vinte reais");
		expect(mergeDictation("Almoço ", "vinte reais")).toBe("Almoço vinte reais");
		expect(mergeDictation("Almoço", "   ")).toBe("Almoço");
	});

	it("traduz os erros e fica quieto quando o dono parou", () => {
		expect(dictationErrorMessage("aborted")).toBeNull();
		expect(dictationErrorMessage("not-allowed")).toMatch(/Permita o microfone/);
		expect(dictationErrorMessage("no-speech")).toMatch(/Não ouvi nada/);
		expect(dictationErrorMessage("qualquer-outro")).toMatch(/Não consegui entender/);
	});

	it("lê a primeira alternativa do resultado", () => {
		expect(transcriptOf([{ transcript: "olá" }, { transcript: "ola" }])).toBe("olá");
		expect(transcriptOf([])).toBe("");
		expect(transcriptOf(undefined)).toBe("");
	});
});
