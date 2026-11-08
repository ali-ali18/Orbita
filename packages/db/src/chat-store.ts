import type { ProposalKind, ProposalStatus } from "@orbita/shared";

export interface ChatConversationRecord {
	id: string;
	/** Primeiras palavras da primeira mensagem do dono. */
	title: string;
	createdAt: Date;
	/** Muda a cada mensagem nova: ordena a lista de conversas. */
	updatedAt: Date;
	/** Agente com quem a conversa foi aberta (persona e ferramentas dele); `null` = Órbita. */
	agentId: string | null;
}

/** Ponto de partida da página seguinte: o último item da página anterior. */
export interface ChatConversationCursor {
	updatedAt: Date;
	id: string;
}

export type ChatRole = "user" | "assistant";

export interface ChatMessageRecord {
	id: string;
	conversationId: string;
	/** Ordem dentro da conversa, a partir de 1. */
	seq: number;
	role: ChatRole;
	text: string;
	/** O que o app desenha embaixo do texto (JSON de `ChatCard`; a proposta guarda só o id e é lida ao vivo). */
	cards: unknown[];
	createdAt: Date;
}

export interface ChatProposalRecord {
	id: string;
	conversationId: string;
	kind: ProposalKind;
	/** O que será feito, já validado, mais o resumo para o card. */
	payload: Record<string, unknown>;
	status: ProposalStatus;
	/** O que foi feito ao confirmar (ids e valores anteriores), para o Desfazer. */
	result: Record<string, unknown> | null;
	createdAt: Date;
	resolvedAt: Date | null;
}

/** Tamanho do título tirado da primeira mensagem (cortado numa palavra, com "…"). */
export const CHAT_TITLE_MAX = 40;
/** Tamanho máximo do nome que o dono digita ao renomear. */
export const CHAT_TITLE_RENAME_MAX = 60;
export const CHAT_TEXT_MAX = 20_000;

/**
 * Conversas do chat, mensagens e propostas de escrita da IA. O histórico mora no servidor.
 * `not_found` para conversa que não existe; `invalid` para texto vazio ou grande demais.
 */
export interface ChatStore {
	/**
	 * O título sai da primeira mensagem (`deriveChatTitle`: curto, cortado numa palavra, nunca vazio).
	 * `agentId` inexistente: `not_found`.
	 */
	createConversation(title: string, options?: { agentId?: string | null }): Promise<ChatConversationRecord>;
	getConversation(id: string): Promise<ChatConversationRecord | null>;
	/**
	 * Da mais recente para a mais antiga (`updatedAt`, desempate por `id`). `limit` padrão 30, máximo 100.
	 * `before`: só as que vêm depois desse ponto (o último item da página anterior). `query`: só as que têm esse
	 * texto no título (sem diferenciar maiúsculas; vazio = todas).
	 */
	listConversations(options?: {
		limit?: number;
		before?: ChatConversationCursor;
		query?: string;
	}): Promise<ChatConversationRecord[]>;
	/** Troca o título (não mexe em `updatedAt`: a ordem da lista fica). `null` se a conversa não existe; vazio é `invalid`. */
	renameConversation(id: string, title: string): Promise<ChatConversationRecord | null>;
	/** Apaga a conversa, as mensagens e as propostas. O custo registrado (uso) fica. `true` se existia. */
	deleteConversation(id: string): Promise<boolean>;
	/** Acrescenta no fim (`seq` = último + 1) e atualiza `updatedAt` da conversa. */
	appendMessage(
		conversationId: string,
		message: { role: ChatRole; text: string; cards?: readonly unknown[] },
	): Promise<ChatMessageRecord>;
	/** Em ordem de `seq`. Com `lastN`, só as últimas N (ainda em ordem crescente). */
	listMessages(conversationId: string, options?: { lastN?: number }): Promise<ChatMessageRecord[]>;

	createProposal(
		conversationId: string,
		input: { kind: ProposalKind; payload: Record<string, unknown> },
	): Promise<ChatProposalRecord>;
	getProposal(id: string): Promise<ChatProposalRecord | null>;
	/** Só as que existem, em ordem qualquer. */
	getProposals(ids: readonly string[]): Promise<ChatProposalRecord[]>;
	/**
	 * Muda a situação só se ela ainda é `from` (comparar e trocar, atômico): devolve a proposta nova, ou `null`
	 * se não existe ou já estava em outra situação (dois toques seguidos nunca executam duas vezes).
	 * `result` (quando enviado) substitui o resultado guardado.
	 */
	transitionProposal(
		id: string,
		from: ProposalStatus,
		to: ProposalStatus,
		options?: { result?: Record<string, unknown> | null; now?: Date },
	): Promise<ChatProposalRecord | null>;
}
