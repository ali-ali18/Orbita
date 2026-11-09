import { ATTACHMENT_MAX_BYTES, type ChatAttachment } from "@orbita/shared";
import { describe, expect, it } from "vitest";
import {
	ATTACHMENT_DEFAULT_ASK,
	buildUserContent,
	checkAttachment,
	checkAttachments,
} from "./attachments.ts";
import { runAgent } from "./loop.ts";
import { buildSystem, STABLE_PROMPT } from "./prompt.ts";
import { fakeReader, MONTH, scriptedClient, TODAY, textBlock, toolContext } from "./test-support.ts";
import { ALL_TOOLS } from "./tools.ts";

const file = (head: number[], mediaType: ChatAttachment["mediaType"], size = 64): ChatAttachment => ({
	mediaType,
	data: Buffer.concat([Buffer.from(head), Buffer.alloc(size)]).toString("base64"),
});
const jpeg = () => file([0xff, 0xd8, 0xff, 0xe0], "image/jpeg");
const png = () => file([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "image/png");
const webp = () => file([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBP")], "image/webp");
const pdf = () => file([...Buffer.from("%PDF-1.7")], "application/pdf");

describe("checkAttachment", () => {
	it("aceita os quatro formatos quando o conteúdo bate com o tipo", () => {
		for (const a of [jpeg(), png(), webp(), pdf()]) expect(checkAttachment(a)).toBeNull();
	});

	it("recusa conteúdo que não bate com o tipo declarado", () => {
		expect(checkAttachment({ ...pdf(), mediaType: "image/png" })).toMatch(/não parece ser do tipo informado/);
		expect(checkAttachment({ ...png(), mediaType: "application/pdf" })).toMatch(/Só aceito/);
		const html: ChatAttachment = {
			mediaType: "application/pdf",
			data: Buffer.from("<html>nada de pdf aqui</html>").toString("base64"),
		};
		expect(checkAttachment(html)).toMatch(/Só aceito foto/);
	});

	it("recusa acima de 5 MB", () => {
		const big = file([0xff, 0xd8, 0xff], "image/jpeg", ATTACHMENT_MAX_BYTES);
		expect(checkAttachment(big)).toBe("O anexo passa de 5 MB. Escolha um arquivo menor.");
		expect(checkAttachments([jpeg(), big])).not.toBeNull();
		expect(checkAttachments([jpeg(), pdf()])).toBeNull();
	});
});

describe("buildUserContent", () => {
	it("sem anexo é só o texto", () => {
		expect(buildUserContent("oi", [])).toBe("oi");
	});

	it("monta aviso de dado, blocos image e document em base64 e o texto do dono por último", () => {
		const a = jpeg();
		const b = pdf();
		const list = buildUserContent("é do mercado", [a, b]) as Array<Record<string, unknown>>;
		expect(list.map((x) => x.type)).toEqual(["text", "image", "document", "text"]);
		expect(String(list[0]?.text)).toMatch(/DADO de terceiro/);
		expect(list[1]).toEqual({
			type: "image",
			source: { type: "base64", media_type: "image/jpeg", data: a.data },
		});
		expect(list[2]).toEqual({
			type: "document",
			source: { type: "base64", media_type: "application/pdf", data: b.data },
		});
		expect(list[3]).toEqual({ type: "text", text: "é do mercado" });
	});

	it("sem texto do dono, pede para ler o anexo e propor o lançamento", () => {
		const list = buildUserContent("  ", [png()]) as Array<Record<string, unknown>>;
		expect(list.at(-1)).toEqual({ type: "text", text: ATTACHMENT_DEFAULT_ASK });
	});
});

describe("prompt e laço", () => {
	it("o prompt trata o conteúdo de anexos como dado", () => {
		expect(STABLE_PROMPT).toMatch(/DENTRO da imagem ou do documento/);
		expect(STABLE_PROMPT).toMatch(/Anexos \(foto ou PDF/);
	});

	it("runAgent manda os blocos do anexo na mensagem do dono", async () => {
		const { client, requests } = scriptedClient([
			() => ({ content: [textBlock("ok")], stopReason: "end_turn" }),
		]);
		const content = buildUserContent("lê isto", [jpeg()]);
		await runAgent(
			{
				client,
				tools: ALL_TOOLS,
				toolContext: toolContext(fakeReader().reader),
				proposals: { create: async () => ({}) as never },
				recordUsage: async () => {},
			},
			{
				model: "claude-sonnet-5-5",
				system: buildSystem({ today: TODAY, month: MONTH, ownerName: null }),
				history: [],
				userText: "lê isto",
				userContent: content,
			},
		);
		expect(requests[0]?.messages.at(-1)).toEqual({ role: "user", content });
	});
});
