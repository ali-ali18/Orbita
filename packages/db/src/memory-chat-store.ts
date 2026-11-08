import { randomUUID } from "node:crypto";
import { cleanChatMessage, cleanChatTitle } from "./chat-rules.ts";
import type {
	ChatConversationRecord,
	ChatMessageRecord,
	ChatProposalRecord,
	ChatStore,
} from "./chat-store.ts";
import { notFound } from "./errors.ts";
import type { Clock } from "./memory-state.ts";

const clone = <T>(value: T): T => structuredClone(value);

/** Implementação em memória, para testes. Segue as mesmas regras da versão Prisma. */
export function createMemoryChatStore(
	now: Clock,
	agentExists: (id: string) => boolean = () => true,
): ChatStore {
	const conversations = new Map<string, ChatConversationRecord>();
	const messages = new Map<string, ChatMessageRecord[]>();
	const proposals = new Map<string, ChatProposalRecord>();
	// Agente apagado: a conversa volta a ser da Órbita (no banco, a chave estrangeira faz o mesmo).
	const view = (row: ChatConversationRecord): ChatConversationRecord => ({
		...row,
		agentId: row.agentId !== null && agentExists(row.agentId) ? row.agentId : null,
	});

	return {
		async createConversation(title, options = {}) {
			if (options.agentId && !agentExists(options.agentId)) throw notFound("Agente", "o");
			const at = now();
			const row: ChatConversationRecord = {
				id: randomUUID(),
				title: cleanChatTitle(title),
				createdAt: at,
				updatedAt: at,
				agentId: options.agentId ?? null,
			};
			conversations.set(row.id, row);
			messages.set(row.id, []);
			return view(row);
		},
		async getConversation(id) {
			const row = conversations.get(id);
			return row ? view(row) : null;
		},
		async listConversations(options = {}) {
			const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);
			return [...conversations.values()]
				.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || (a.id < b.id ? 1 : -1))
				.slice(0, limit)
				.map(view);
		},
		async deleteConversation(id) {
			if (!conversations.delete(id)) return false;
			messages.delete(id);
			for (const [proposalId, p] of proposals) if (p.conversationId === id) proposals.delete(proposalId);
			return true;
		},
		async appendMessage(conversationId, message) {
			const conversation = conversations.get(conversationId);
			if (!conversation) throw notFound("Conversa");
			const clean = cleanChatMessage(message);
			const list = messages.get(conversationId) ?? [];
			const at = now();
			const row: ChatMessageRecord = {
				id: randomUUID(),
				conversationId,
				seq: (list.at(-1)?.seq ?? 0) + 1,
				...clean,
				cards: clone([...(message.cards ?? [])]),
				createdAt: at,
			};
			list.push(row);
			messages.set(conversationId, list);
			conversation.updatedAt = at;
			return clone(row);
		},
		async listMessages(conversationId, options = {}) {
			const list = messages.get(conversationId) ?? [];
			const n = options.lastN;
			return clone(n === undefined ? list : n <= 0 ? [] : list.slice(-n));
		},
		async createProposal(conversationId, input) {
			if (!conversations.has(conversationId)) throw notFound("Conversa");
			const row: ChatProposalRecord = {
				id: randomUUID(),
				conversationId,
				kind: input.kind,
				payload: clone(input.payload),
				status: "pending",
				result: null,
				createdAt: now(),
				resolvedAt: null,
			};
			proposals.set(row.id, row);
			return clone(row);
		},
		async getProposal(id) {
			const row = proposals.get(id);
			return row ? clone(row) : null;
		},
		async getProposals(ids) {
			return ids.flatMap((id) => {
				const row = proposals.get(id);
				return row ? [clone(row)] : [];
			});
		},
		async transitionProposal(id, from, to, options = {}) {
			const row = proposals.get(id);
			if (!row || row.status !== from) return null;
			row.status = to;
			if (options.result !== undefined) row.result = options.result === null ? null : clone(options.result);
			row.resolvedAt = to === "pending" ? null : (options.now ?? now());
			return clone(row);
		},
	};
}
