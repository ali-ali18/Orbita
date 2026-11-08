import type { LocalDate } from "@orbita/core";
import type { AgentDto, ChatConversationDto } from "@orbita/shared";
import type { AgentVisualKey } from "@orbita/tokens";
import { saoPauloStamp } from "../../lib/format.ts";
import { visualKey } from "../agents/agents-model.ts";

/*
 * Lógica pura da lista de conversas: a gaveta do chat mostra só as mais recentes e a tela "Conversas" traz tudo,
 * em páginas, com busca no servidor. O app não decide ordem nem tamanho de página: só desenha o que o servidor manda.
 */

/** Quantas conversas a gaveta do chat mostra (o resto fica em "Ver todas"). */
export const RECENT_COUNT = 3;
/** Tamanho de página da tela "Conversas" (o servidor aceita de 1 a 50). */
export const PAGE_SIZE = 20;
export const SEARCH_MAX = 100;
export const RENAME_MAX = 60;

const MONTHS_SHORT = [
	"jan",
	"fev",
	"mar",
	"abr",
	"mai",
	"jun",
	"jul",
	"ago",
	"set",
	"out",
	"nov",
	"dez",
] as const;

/** A gaveta oferece "Ver todas" só quando o servidor avisa que há mais (`nextCursor`). */
export const showSeeAll = (nextCursor: string | null | undefined): boolean => Boolean(nextCursor);

/** Junta as páginas já carregadas sem repetir conversa (uma página nova pode trazer uma que já veio). */
export function flattenConversationPages(
	pages: readonly { conversations: readonly ChatConversationDto[] }[],
): ChatConversationDto[] {
	const seen = new Set<string>();
	const out: ChatConversationDto[] = [];
	for (const page of pages) {
		for (const conversation of page.conversations) {
			if (seen.has(conversation.id)) continue;
			seen.add(conversation.id);
			out.push(conversation);
		}
	}
	return out;
}

/** O texto da busca que vai ao servidor: sem espaços nas pontas, e `undefined` quando vazio (lista completa). */
export function searchTerm(text: string): string | undefined {
	const term = text.trim().slice(0, SEARCH_MAX);
	return term === "" ? undefined : term;
}

/** Quando a conversa foi mexida: "14:30" hoje, "ontem" e "3 nov"; de outro ano, "3 nov 2025". */
export function conversationWhen(iso: string, today: LocalDate): string {
	const stamp = saoPauloStamp(iso);
	if (!stamp) return "";
	if (stamp.date === today) return stamp.time;
	const yesterday = new Date(`${today}T12:00:00Z`);
	yesterday.setUTCDate(yesterday.getUTCDate() - 1);
	if (stamp.date === yesterday.toISOString().slice(0, 10)) return "ontem";
	const day = Number(stamp.date.slice(8, 10));
	const month = MONTHS_SHORT[Number(stamp.date.slice(5, 7)) - 1] ?? "";
	const year = stamp.date.slice(0, 4);
	return year === today.slice(0, 4) ? `${day} ${month}` : `${day} ${month} ${year}`;
}

/** Título para a lista: nunca vazio (o servidor já garante, mas dado antigo ou estranho não quebra a tela). */
export function conversationTitle(title: string): string {
	const text = title.trim();
	return text === "" ? "Conversa" : text;
}

export interface AgentBadge {
	name: string;
	visual: AgentVisualKey;
}

/** O selo do agente da conversa; `null` para a Órbita (sem agente) ou agente que não está mais na lista. */
export function agentBadgeFor(
	agentId: string | null,
	agents: readonly Pick<AgentDto, "id" | "name" | "builtinKey">[],
): AgentBadge | null {
	if (agentId === null) return null;
	const agent = agents.find((a) => a.id === agentId);
	return agent ? { name: agent.name, visual: visualKey(agent) } : null;
}

/** Mesma regra do servidor para o novo nome: nada de vazio nem acima de 60 letras. `null` = pode salvar. */
export function renameError(text: string): string | null {
	const name = text.replace(/\s+/g, " ").trim();
	if (name === "") return "Dê um nome à conversa.";
	if ([...name].length > RENAME_MAX) return `O nome tem até ${RENAME_MAX} letras.`;
	return null;
}

/** Texto da tela vazia: sem busca é "ainda não conversou"; com busca, nada casou. */
export function emptyConversations(term: string | undefined): { title: string; caption: string } {
	if (term) return { title: `Nada encontrado para “${term}”`, caption: "Tente outra palavra do título." };
	return {
		title: "Nenhuma conversa ainda",
		caption: "Pergunte algo à Órbita e a conversa fica guardada aqui.",
	};
}
