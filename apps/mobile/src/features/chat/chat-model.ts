import {
	CHAT_ERROR_CODES,
	type ChatCard,
	type ChatEvent,
	type ChatMessageDto,
	type ProposalDto,
} from "@orbita/shared";

/*
 * Estado do chat, em funções puras (o componente só liga isto ao React). O texto e os números chegam prontos do
 * servidor: aqui nada é calculado, só juntado e mostrado.
 */

export type ChatBubble =
	| { id: string; kind: "user"; text: string }
	| {
			id: string;
			kind: "assistant";
			text: string;
			cards: ChatCard[];
			streaming: boolean;
			tool: string | null;
	  }
	| { id: string; kind: "notice"; text: string; action: "open-server" | null };

export interface ChatState {
	conversationId: string | null;
	bubbles: ChatBubble[];
	/** Há uma resposta chegando: o campo de envio espera. */
	busy: boolean;
	/** Modelo que respondeu (ou está respondendo) o último turno; `null` antes da primeira resposta. */
	model: string | null;
}

export const initialChatState: ChatState = { conversationId: null, bubbles: [], busy: false, model: null };

export type ChatAction =
	| { type: "sent"; text: string; userId: string; assistantId: string }
	| { type: "event"; event: ChatEvent }
	| { type: "failed"; id: string; code: string; message: string }
	| { type: "reset" }
	| { type: "loaded"; conversationId: string; messages: readonly ChatMessageDto[] }
	| { type: "proposal"; proposal: ProposalDto }
	| { type: "local"; id: string; userText: string; replyText: string }
	| { type: "notice"; id: string; text: string };

/** Mensagem para quem ainda não cadastrou a chave: o servidor devolve a mesma, o app só liga o botão. */
export const NO_KEY_ACTION_LABEL = "Abrir Servidor e chaves";

const lastIndex = (bubbles: readonly ChatBubble[]) => bubbles.length - 1;

function mapStreaming(
	bubbles: ChatBubble[],
	change: (bubble: Extract<ChatBubble, { kind: "assistant" }>) => Extract<ChatBubble, { kind: "assistant" }>,
): ChatBubble[] {
	const i = lastIndex(bubbles);
	const last = bubbles[i];
	if (last?.kind !== "assistant" || !last.streaming) return bubbles;
	return [...bubbles.slice(0, i), change(last)];
}

function noticeFor(id: string, code: string, message: string): ChatBubble {
	return {
		id,
		kind: "notice",
		text: message,
		action: code === CHAT_ERROR_CODES.noKey || code === CHAT_ERROR_CODES.unreadableKey ? "open-server" : null,
	};
}

/** Tira a bolha de resposta que ficou vazia (a resposta falhou antes de dizer algo). */
function dropEmptyStreaming(bubbles: ChatBubble[]): ChatBubble[] {
	const last = bubbles[lastIndex(bubbles)];
	if (last?.kind === "assistant" && last.streaming && last.text === "" && last.cards.length === 0) {
		return bubbles.slice(0, lastIndex(bubbles));
	}
	return bubbles;
}

function endStreaming(bubbles: ChatBubble[]): ChatBubble[] {
	return mapStreaming(bubbles, (b) => ({ ...b, streaming: false, tool: null }));
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
	switch (action.type) {
		case "sent":
			return {
				...state,
				busy: true,
				bubbles: [
					...state.bubbles,
					{ id: action.userId, kind: "user", text: action.text },
					{ id: action.assistantId, kind: "assistant", text: "", cards: [], streaming: true, tool: null },
				],
			};
		case "event": {
			const event = action.event;
			if (event.type === "meta") {
				return { ...state, conversationId: event.conversationId, model: event.model ?? state.model };
			}
			if (event.type === "text") {
				return {
					...state,
					bubbles: mapStreaming(state.bubbles, (b) => ({ ...b, text: b.text + event.delta, tool: null })),
				};
			}
			if (event.type === "tool") {
				return { ...state, bubbles: mapStreaming(state.bubbles, (b) => ({ ...b, tool: event.label })) };
			}
			if (event.type === "card") {
				return {
					...state,
					bubbles: mapStreaming(state.bubbles, (b) => ({
						...b,
						cards: [...b.cards, event.card],
						tool: null,
					})),
				};
			}
			if (event.type === "done") return { ...state, busy: false, bubbles: endStreaming(state.bubbles) };
			// error: o que já chegou fica; o aviso vem depois.
			return {
				...state,
				busy: false,
				bubbles: [
					...endStreaming(dropEmptyStreaming(state.bubbles)),
					noticeFor(`erro-${state.bubbles.length}`, event.code, event.message),
				],
			};
		}
		case "failed":
			return {
				...state,
				busy: false,
				bubbles: [
					...endStreaming(dropEmptyStreaming(state.bubbles)),
					noticeFor(action.id, action.code, action.message),
				],
			};
		case "reset":
			return initialChatState;
		case "loaded":
			return {
				conversationId: action.conversationId,
				busy: false,
				model: null,
				bubbles: action.messages.map(
					(m): ChatBubble =>
						m.role === "user"
							? { id: m.id, kind: "user", text: m.text }
							: { id: m.id, kind: "assistant", text: m.text, cards: m.cards, streaming: false, tool: null },
				),
			};
		case "proposal":
			return {
				...state,
				bubbles: state.bubbles.map((b) =>
					b.kind === "assistant" &&
					b.cards.some((c) => c.type === "proposal" && c.proposal.id === action.proposal.id)
						? {
								...b,
								cards: b.cards.map((c) =>
									c.type === "proposal" && c.proposal.id === action.proposal.id
										? { type: "proposal" as const, proposal: action.proposal }
										: c,
								),
							}
						: b,
				),
			};
		case "notice":
			return {
				...state,
				bubbles: [...state.bubbles, { id: action.id, kind: "notice", text: action.text, action: null }],
			};
		case "local":
			return {
				...state,
				bubbles: [
					...state.bubbles,
					{ id: `${action.id}-u`, kind: "user", text: action.userText },
					{
						id: `${action.id}-a`,
						kind: "assistant",
						text: action.replyText,
						cards: [],
						streaming: false,
						tool: null,
					},
				],
			};
	}
}

/** Rótulo da situação de uma proposta já respondida. */
export const PROPOSAL_STATUS_LABEL = {
	pending: "Aguardando você",
	confirmed: "Feito",
	canceled: "Cancelado",
	undone: "Desfeito",
} as const;

/** Linha "Valor" de uma proposta, para o destaque do card (a linha é texto pronto do servidor). */
export function proposalAmount(proposal: ProposalDto): string | null {
	return proposal.lines.find((line) => line.label === "Valor")?.value ?? null;
}

/** Título curto de uma conversa para a lista de histórico: a data fica a cargo de quem chama. */
export function conversationLabel(title: string): string {
	const text = title.trim();
	return text === "" ? "Conversa" : text;
}
