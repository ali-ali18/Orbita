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

export const CHAT_TITLE_MAX = 60;
export const CHAT_TEXT_MAX = 20_000;

/**
 * Conversas do chat, mensagens e propostas de escrita da IA. O histórico mora no servidor.
 * `not_found` para conversa que não existe; `invalid` para texto vazio ou grande demais.
 */
export interface ChatStore {
	/** O título é saneado (espaços, tamanho) pelo store. `agentId` inexistente: `not_found`. */
	createConversation(title: string, options?: { agentId?: string | null }): Promise<ChatConversationRecord>;
	getConversation(id: string): Promise<ChatConversationRecord | null>;
	/** Da mais recente para a mais antiga. `limit` padrão 30, máximo 100. */
	listConversations(options?: { limit?: number }): Promise<ChatConversationRecord[]>;
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
