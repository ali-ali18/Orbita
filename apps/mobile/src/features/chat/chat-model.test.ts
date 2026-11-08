import type { ChatCard, ChatEvent, ChatMessageDto, ProposalDto } from "@orbita/shared";
import { describe, expect, it } from "vitest";
import {
	type ChatAction,
	type ChatState,
	chatReducer,
	conversationLabel,
	initialChatState,
	proposalAmount,
} from "./chat-model.ts";

const run = (actions: ChatAction[], from: ChatState = initialChatState) => actions.reduce(chatReducer, from);
const ev = (event: ChatEvent): ChatAction => ({ type: "event", event });
const sent: ChatAction = { type: "sent", text: "oi", userId: "u1", assistantId: "a1" };

const rowsCard: ChatCard = {
	type: "rows",
	tool: "get_month_summary",
	title: "Resumo de 2026-11",
	rows: [{ label: "Gastos", caption: null, value: "R$ 520,67", cents: 52067 }],
	total: null,
};
const proposal = (status: ProposalDto["status"] = "pending"): ProposalDto => ({
	id: "p1",
	kind: "create_transaction",
	status,
	title: "Lançar gasto",
	transactionId: status === "confirmed" ? "t1" : null,
	lines: [
		{ label: "Valor", value: "−R$ 46,90" },
		{ label: "Onde", value: "Nubank (cartão)" },
	],
});

describe("estado do chat", () => {
	it("enviar abre a bolha do dono e uma de resposta esperando, e trava o envio", () => {
		const state = run([sent]);
		expect(state.busy).toBe(true);
		expect(state.bubbles).toEqual([
			{ id: "u1", kind: "user", text: "oi" },
			{ id: "a1", kind: "assistant", text: "", cards: [], streaming: true, tool: null },
		]);
	});

	it("texto chega aos poucos, a ferramenta aparece enquanto roda e o card entra na resposta", () => {
		const state = run([
			sent,
			ev({ type: "meta", conversationId: "c1" }),
			ev({ type: "tool", name: "get_month_summary", label: "Consultando o resumo do mês…" }),
		]);
		expect(state.conversationId).toBe("c1");
		expect(state.bubbles[1]).toMatchObject({ tool: "Consultando o resumo do mês…", text: "" });

		const after = run(
			[
				ev({ type: "card", card: rowsCard }),
				ev({ type: "text", delta: "Você " }),
				ev({ type: "text", delta: "gastou." }),
				ev({ type: "done", messageId: "m" }),
			],
			state,
		);
		expect(after.busy).toBe(false);
		expect(after.bubbles[1]).toEqual({
			id: "a1",
			kind: "assistant",
			text: "Você gastou.",
			cards: [rowsCard],
			streaming: false,
			tool: null,
		});
	});

	it("falha antes de qualquer resposta tira a bolha vazia e mostra o aviso; sem chave oferece abrir Servidor e chaves", () => {
		const noKey = run([
			sent,
			{
				type: "failed",
				id: "n1",
				code: "sem_chave_anthropic",
				message: "Cadastre a chave da Anthropic em Configurações → Servidor e chaves.",
			},
		]);
		expect(noKey.busy).toBe(false);
		expect(noKey.bubbles).toEqual([
			{ id: "u1", kind: "user", text: "oi" },
			{
				id: "n1",
				kind: "notice",
				text: "Cadastre a chave da Anthropic em Configurações → Servidor e chaves.",
				action: "open-server",
			},
		]);
		const limit = run([
			sent,
			{ type: "failed", id: "n1", code: "limite_mensal_ia", message: "Limite atingido." },
		]);
		expect(limit.bubbles.at(-1)).toMatchObject({ kind: "notice", action: null });
	});

	it("erro no meio do fluxo mantém o que já chegou e acrescenta o aviso", () => {
		const state = run([
			sent,
			ev({ type: "text", delta: "Parcial" }),
			ev({ type: "error", code: "sobrecarga", message: "A Anthropic está instável agora." }),
		]);
		expect(state.busy).toBe(false);
		expect(state.bubbles[1]).toMatchObject({ kind: "assistant", text: "Parcial", streaming: false });
		expect(state.bubbles[2]).toMatchObject({
			kind: "notice",
			text: "A Anthropic está instável agora.",
			action: null,
		});
	});

	it("evento depois do fim não mexe em bolha nenhuma", () => {
		const done = run([sent, ev({ type: "text", delta: "a" }), ev({ type: "done", messageId: "m" })]);
		expect(run([ev({ type: "text", delta: "tarde" })], done).bubbles).toEqual(done.bubbles);
	});

	it("atualiza o card da proposta no lugar quando o servidor responde", () => {
		const state = run([
			sent,
			ev({ type: "card", card: { type: "proposal", proposal: proposal() } }),
			ev({ type: "done", messageId: "m" }),
			{ type: "proposal", proposal: proposal("confirmed") },
		]);
		const cards = (state.bubbles[1] as Extract<ChatState["bubbles"][number], { kind: "assistant" }>).cards;
		expect(cards).toEqual([{ type: "proposal", proposal: proposal("confirmed") }]);
	});

	it("abrir uma conversa do servidor troca tudo; nova conversa volta ao começo", () => {
		const messages: ChatMessageDto[] = [
			{ id: "m1", role: "user", text: "oi", cards: [], createdAt: "2026-11-15T12:00:00.000Z" },
			{ id: "m2", role: "assistant", text: "Olá!", cards: [rowsCard], createdAt: "2026-11-15T12:00:01.000Z" },
		];
		const loaded = run([{ type: "loaded", conversationId: "c9", messages }]);
		expect(loaded.conversationId).toBe("c9");
		expect(loaded.bubbles).toHaveLength(2);
		expect(loaded.bubbles[1]).toMatchObject({ kind: "assistant", streaming: false, cards: [rowsCard] });
		expect(run([{ type: "reset" }], loaded)).toEqual(initialChatState);
	});

	it("mensagens locais (comprovante, foto) e avisos entram sem travar o envio", () => {
		const state = run([
			{ type: "local", id: "l1", userText: "Comprovante", replyText: "Recebi." },
			{ type: "notice", id: "n2", text: "Não consegui concluir." },
		]);
		expect(state.busy).toBe(false);
		expect(state.bubbles.map((b) => b.kind)).toEqual(["user", "assistant", "notice"]);
	});
});

describe("apoio", () => {
	it("destaca o valor da proposta e dá nome a conversa sem título", () => {
		expect(proposalAmount(proposal())).toBe("−R$ 46,90");
		expect(proposalAmount({ ...proposal(), lines: [] })).toBeNull();
		expect(conversationLabel("  ")).toBe("Conversa");
		expect(conversationLabel("Quanto gastei?")).toBe("Quanto gastei?");
	});
});
