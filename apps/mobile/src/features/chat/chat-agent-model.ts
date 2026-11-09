import type { AgentDto, BuiltinAgentKey } from "@orbita/shared";
import type { AgentVisualKey } from "@orbita/tokens";
import { visualKey } from "../agents/agents-model.ts";

/*
 * Com quem o chat está falando: o nome e o rosto do cabeçalho, a frase do estado vazio e as sugestões. Lógica pura.
 * O papel e as ferramentas do agente são do servidor (`resolvePersona`); aqui só o que aparece na tela.
 */

export interface ChatAgentView {
	/** `null` = a Órbita (chat padrão, sem agente na conversa). */
	id: string | null;
	name: string;
	visual: AgentVisualKey;
	/** Frase do estado vazio, abaixo do "Olá". */
	intro: string;
	/** Perguntas prontas do estado vazio. Cada uma vira a mensagem do dono (a de anexo abre o seletor). */
	suggestions: readonly string[];
}

/** A sugestão que abre o seletor de comprovante em vez de mandar texto (só a Órbita lê anexos). */
export const ATTACH_SUGGESTION = "Ler um comprovante";

export const ORBITA_VIEW: ChatAgentView = {
	id: null,
	name: "Órbita",
	visual: "orbita",
	intro: "Como posso te ajudar com o seu dinheiro?",
	suggestions: ["Quanto gastei com delivery?", "Lançar um gasto", "Como fecha o mês?", ATTACH_SUGGESTION],
};

const BUILTIN_TEXT: Record<
	Exclude<BuiltinAgentKey, "orbita">,
	{ intro: string; suggestions: readonly string[] }
> = {
	vigia: {
		intro: "Posso olhar os gastos que fogem do seu orçamento.",
		suggestions: [
			"Algum gasto fora do normal?",
			"Quanto falta no orçamento?",
			"Onde mais gastei este mês?",
			"Tem cobrança repetida?",
		],
	},
	caca_assinatura: {
		intro: "Posso procurar cobranças que se repetem.",
		suggestions: [
			"Quais são minhas assinaturas?",
			"Alguma renovação chegando?",
			"Tem assinatura que subiu de preço?",
			"Quanto pago por mês em assinaturas?",
		],
	},
	cofrinho: {
		intro: "Posso sugerir quanto vale guardar este mês.",
		suggestions: [
			"Quanto posso guardar este mês?",
			"Sobra dinheiro depois das contas?",
			"Como estão minhas metas?",
		],
	},
	fechamento: {
		intro: "Posso resumir o mês e comparar com o anterior.",
		suggestions: [
			"Como foi o mês?",
			"Comparar com o mês passado",
			"Onde o dinheiro foi?",
			"Como está o orçamento?",
		],
	},
	metas: {
		intro: "Posso acompanhar o ritmo das suas metas.",
		suggestions: ["Como estão minhas metas?", "Qual meta está mais atrasada?", "Quanto guardar por mês?"],
	},
	economia: {
		intro: "Posso achar onde dá para cortar gastos.",
		suggestions: [
			"Onde dá para cortar gastos?",
			"Quanto posso economizar por mês?",
			"Quais taxas e juros estou pagando?",
		],
	},
};

const CUSTOM_SUGGESTIONS = ["O que você faz?", "Como foi o mês?", "Resuma o que você viu"] as const;

/**
 * O agente do chat. Sem id é a Órbita. Com id e a lista de agentes ainda carregando (ou o agente apagado), vale um
 * rosto neutro com o nome "Agente": nunca mostra a Órbita no lugar de outro agente.
 */
export function chatAgentView(
	agentId: string | null,
	agents: readonly Pick<AgentDto, "id" | "name" | "builtinKey">[] | undefined,
): ChatAgentView {
	if (agentId === null) return ORBITA_VIEW;
	const agent = agents?.find((a) => a.id === agentId);
	if (!agent) {
		return { id: agentId, name: "Agente", visual: "custom", intro: "Como posso ajudar?", suggestions: [] };
	}
	if (agent.builtinKey === "orbita") return { ...ORBITA_VIEW, id: agent.id };
	const visual = visualKey(agent);
	if (agent.builtinKey !== null) {
		const text = BUILTIN_TEXT[agent.builtinKey];
		return { id: agent.id, name: agent.name, visual, intro: text.intro, suggestions: text.suggestions };
	}
	return {
		id: agent.id,
		name: agent.name,
		visual,
		intro: "Pergunte o que quiser dentro do que eu leio.",
		suggestions: CUSTOM_SUGGESTIONS,
	};
}
