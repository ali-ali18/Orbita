import type { ProposalKind, ProposalStatus } from "@orbita/shared";
import { cleanChatMessage, cleanChatTitle } from "./chat-rules.ts";
import type {
	ChatConversationRecord,
	ChatMessageRecord,
	ChatProposalRecord,
	ChatRole,
	ChatStore,
} from "./chat-store.ts";
import type { Db } from "./client.ts";
import { notFound } from "./errors.ts";
import { Prisma } from "./generated/prisma/client.ts";
import type { Clock } from "./memory-state.ts";
import { isForeignKeyViolation, isUniqueViolation } from "./prisma-errors.ts";

const asObject = (value: unknown): Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};

const toConversation = (row: {
	id: string;
	title: string;
	createdAt: Date;
	updatedAt: Date;
}): ChatConversationRecord => ({
	id: row.id,
	title: row.title,
	createdAt: row.createdAt,
	updatedAt: row.updatedAt,
});

const toMessage = (row: {
	id: string;
	conversationId: string;
	seq: number;
	role: string;
	text: string;
	cards: unknown;
	createdAt: Date;
}): ChatMessageRecord => ({
	id: row.id,
	conversationId: row.conversationId,
	seq: row.seq,
	role: row.role as ChatRole,
	text: row.text,
	cards: Array.isArray(row.cards) ? row.cards : [],
	createdAt: row.createdAt,
});

const toProposal = (row: {
	id: string;
	conversationId: string;
	kind: string;
	payload: unknown;
	status: string;
	result: unknown;
	createdAt: Date;
	resolvedAt: Date | null;
}): ChatProposalRecord => ({
	id: row.id,
	conversationId: row.conversationId,
	kind: row.kind as ProposalKind,
	payload: asObject(row.payload),
	status: row.status as ProposalStatus,
	result: row.result === null ? null : asObject(row.result),
	createdAt: row.createdAt,
	resolvedAt: row.resolvedAt,
});

const APPEND_ATTEMPTS = 5;

export function createPrismaChatStore(db: Db, now: Clock): ChatStore {
	return {
		async createConversation(title) {
			const at = now();
			return toConversation(
				await db.chatConversation.create({
					data: { title: cleanChatTitle(title), createdAt: at, updatedAt: at },
				}),
			);
		},
		async getConversation(id) {
			const row = await db.chatConversation.findUnique({ where: { id } });
			return row ? toConversation(row) : null;
		},
		async listConversations(options = {}) {
			const take = Math.min(Math.max(options.limit ?? 30, 1), 100);
			const rows = await db.chatConversation.findMany({
				orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
				take,
			});
			return rows.map(toConversation);
		},
		async deleteConversation(id) {
			const res = await db.chatConversation.deleteMany({ where: { id } });
			return res.count > 0;
		},
		async appendMessage(conversationId, message) {
			const clean = cleanChatMessage(message);
			const cards = [...(message.cards ?? [])] as Prisma.InputJsonValue[];
			// `seq` = último + 1. Duas gravações simultâneas disputam a unicidade (conversa, seq): quem perde repete.
			for (let attempt = 1; ; attempt += 1) {
				try {
					return await db.$transaction(async (tx) => {
						const conversation = await tx.chatConversation.findUnique({
							where: { id: conversationId },
							select: { id: true },
						});
						if (!conversation) throw notFound("Conversa");
						const last = await tx.chatMessage.aggregate({
							where: { conversationId },
							_max: { seq: true },
						});
						const at = now();
						const row = await tx.chatMessage.create({
							data: { conversationId, seq: (last._max.seq ?? 0) + 1, ...clean, cards, createdAt: at },
						});
						await tx.chatConversation.update({ where: { id: conversationId }, data: { updatedAt: at } });
						return toMessage(row);
					});
				} catch (error) {
					if (isUniqueViolation(error) && attempt < APPEND_ATTEMPTS) continue;
					throw error;
				}
			}
		},
		async listMessages(conversationId, options = {}) {
			const n = options.lastN;
			if (n !== undefined && n <= 0) return [];
			const rows = await db.chatMessage.findMany({
				where: { conversationId },
				orderBy: { seq: n === undefined ? "asc" : "desc" },
				...(n === undefined ? {} : { take: n }),
			});
			return (n === undefined ? rows : rows.reverse()).map(toMessage);
		},
		async createProposal(conversationId, input) {
			try {
				return toProposal(
					await db.chatProposal.create({
						data: {
							conversationId,
							kind: input.kind,
							payload: input.payload as Prisma.InputJsonObject,
							createdAt: now(),
						},
					}),
				);
			} catch (error) {
				if (isForeignKeyViolation(error)) throw notFound("Conversa");
				throw error;
			}
		},
		async getProposal(id) {
			const row = await db.chatProposal.findUnique({ where: { id } });
			return row ? toProposal(row) : null;
		},
		async getProposals(ids) {
			if (ids.length === 0) return [];
			return (await db.chatProposal.findMany({ where: { id: { in: [...ids] } } })).map(toProposal);
		},
		async transitionProposal(id, from, to, options = {}) {
			const at = options.now ?? now();
			// Um UPDATE só, com a situação de partida no WHERE: quem chega depois não muda nada.
			const res = await db.chatProposal.updateMany({
				where: { id, status: from },
				data: {
					status: to,
					resolvedAt: at,
					...(options.result === undefined
						? {}
						: {
								result:
									options.result === null ? Prisma.JsonNull : (options.result as Prisma.InputJsonObject),
							}),
				},
			});
			if (res.count === 0) return null;
			const row = await db.chatProposal.findUnique({ where: { id } });
			return row ? toProposal(row) : null;
		},
	};
}
