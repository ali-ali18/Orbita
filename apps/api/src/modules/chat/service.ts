import {
	type AgentEvent,
	ALL_TOOLS,
	applyProposal,
	buildAgentSystem,
	type ChatModelConfig,
	costMicroUsd,
	isMainModel,
	type ModelClient,
	type ModelMessage,
	type ProposalDraft,
	pickModel,
	resolveChatModels,
	resolvePersona,
	resolveSetupPersona,
	runAgent,
	SETUP_TASK_TEXT,
	ToolError,
	templateSetupDraft,
	undoProposal,
} from "@orbita/agents";
import { monthOf, toLocalDate } from "@orbita/core";
import {
	type AgentRecord,
	type ChatMessageRecord,
	type ChatProposalRecord,
	DataError,
	type SecretVault,
	type Stores,
} from "@orbita/db";
import { budgetBlock, limitMessage } from "@orbita/ledger";
import {
	appliedView,
	CHAT_ERROR_CODES,
	type ChatCard,
	type ChatMessageDto,
	chatCardSchema,
	type ProposalDto,
	type ProposalStatus,
	SETUP_USER_MESSAGE,
	type SetupProposal,
	setupProposalSchema,
	setupSelectionSchema,
} from "@orbita/shared";
import { z } from "zod";
import { createAgentReader, createAgentWriter } from "./backend.ts";

/** Quantas mensagens anteriores vão ao modelo (as mais recentes). */
export const HISTORY_MESSAGES = 20;

export interface ChatServiceDeps {
	stores: Stores;
	vault: SecretVault;
	now: () => Date;
	/** Cria o cliente do modelo com a chave lida do cofre (os testes injetam um falso). */
	createClient: (apiKey: string) => ModelClient;
	models: ChatModelConfig;
	/** Log do servidor para falhas inesperadas (nunca vai ao app). */
	logError?: (message: string, error: unknown) => void;
}

/** Erro de pré-condição do chat, devolvido como JSON antes de abrir o fluxo SSE. */
export class ChatPreconditionError extends Error {
	readonly status: 403 | 409;
	readonly code: string;
	constructor(status: 403 | 409, code: string, message: string) {
		super(message);
		this.name = "ChatPreconditionError";
		this.status = status;
		this.code = code;
	}
}

// ------------------------------------------------------------- limite e custo

// O limite mensal é o mesmo do worker dos agentes (`@orbita/ledger`).
export { budgetBlock, limitMessage };

/** Chave da Anthropic aberta do cofre, ou um erro de pré-condição em pt-BR. */
export async function requireApiKey(vault: SecretVault): Promise<string> {
	let key: string | null;
	try {
		key = await vault.read("anthropic_api_key");
	} catch {
		throw new ChatPreconditionError(
			409,
			CHAT_ERROR_CODES.unreadableKey,
			"Não consegui abrir a chave da Anthropic (o segredo do servidor mudou?). Cadastre a chave de novo em Configurações → Servidor e chaves.",
		);
	}
	if (key === null) {
		throw new ChatPreconditionError(
			409,
			CHAT_ERROR_CODES.noKey,
			"Cadastre a chave da Anthropic em Configurações → Servidor e chaves.",
		);
	}
	return key;
}

// ------------------------------------------------------------------ propostas

const envelope = z.object({
	action: z.record(z.string(), z.unknown()),
	title: z.string(),
	lines: z.array(z.object({ label: z.string(), value: z.string() })),
});

function resultTransactionId(result: Record<string, unknown> | null): string | null {
	const id = result?.transactionId;
	return typeof id === "string" ? id : null;
}

/**
 * Os itens do card "Configurar com a Órbita". Pendente ou cancelada: tudo que foi proposto. Confirmada ou desfeita: só
 * o que o dono aplicou, com os nomes e categorias que ele deixou (guardados em `result.applied`).
 */
function setupView(p: ChatProposalRecord, action: Record<string, unknown>): SetupProposal | undefined {
	if (p.kind !== "setup") return undefined;
	const proposal = setupProposalSchema.safeParse(action);
	if (!proposal.success) return undefined;
	if (p.status === "confirmed" || p.status === "undone") {
		const applied = setupSelectionSchema.safeParse(p.result?.applied);
		if (applied.success) return appliedView(proposal.data, applied.data);
	}
	return proposal.data;
}

export function toProposalDto(p: ChatProposalRecord): ProposalDto {
	const parsed = envelope.safeParse(p.payload);
	const setup = parsed.success ? setupView(p, parsed.data.action) : undefined;
	return {
		id: p.id,
		kind: p.kind,
		status: p.status,
		title: parsed.success ? parsed.data.title : "Proposta",
		lines: parsed.success ? parsed.data.lines : [],
		transactionId: p.status === "confirmed" ? resultTransactionId(p.result) : null,
		...(setup ? { setup } : {}),
	};
}

const STATUS_PT: Record<ProposalStatus, string> = {
	pending: "ainda não foi respondida",
	confirmed: "foi confirmada",
	canceled: "foi cancelada",
	undone: "foi desfeita",
};

async function transition(
	deps: ChatServiceDeps,
	id: string,
	from: ProposalStatus,
	to: ProposalStatus,
	result?: Record<string, unknown> | null,
) {
	return deps.stores.chat.transitionProposal(id, from, to, result === undefined ? {} : { result });
}

async function loadProposal(deps: ChatServiceDeps, id: string): Promise<ChatProposalRecord> {
	const found = await deps.stores.chat.getProposal(id);
	if (!found) throw new DataError("not_found", "Proposta não encontrada.");
	return found;
}

function alreadyAnswered(p: ChatProposalRecord, wanted: string): DataError {
	return new DataError("duplicate", `Esta proposta ${STATUS_PT[p.status]}; não dá para ${wanted}.`);
}

/** A IA nunca escreve sozinha: é aqui, quando o dono toca em "Confirmar", que a escrita acontece. */
export async function confirmProposal(
	deps: ChatServiceDeps,
	id: string,
	selection?: unknown,
): Promise<ProposalDto> {
	const current = await loadProposal(deps, id);
	// O que o dono marcou e editou só existe na proposta de configuração.
	if (selection !== undefined && current.kind !== "setup") {
		throw new DataError("invalid", "Esta proposta não tem itens para escolher.");
	}
	// Comparar e trocar: dois toques seguidos nunca executam duas vezes.
	const claimed = await transition(deps, id, "pending", "confirmed");
	if (!claimed) throw alreadyAnswered(current, "confirmar");
	try {
		const action = envelope.parse(claimed.payload).action;
		const applied = await applyProposal(
			claimed.kind,
			action,
			createAgentWriter(deps.stores, deps.now),
			selection,
		);
		const done = await transition(deps, id, "confirmed", "confirmed", applied.result);
		return toProposalDto(done ?? claimed);
	} catch (error) {
		// Não executou: volta a pendente para o dono tentar de novo ou cancelar.
		await transition(deps, id, "confirmed", "pending", null);
		if (error instanceof ToolError) throw new DataError("invalid", error.message);
		throw error;
	}
}

export async function cancelProposal(deps: ChatServiceDeps, id: string): Promise<ProposalDto> {
	const current = await loadProposal(deps, id);
	const canceled = await transition(deps, id, "pending", "canceled");
	if (!canceled) throw alreadyAnswered(current, "cancelar");
	return toProposalDto(canceled);
}

export async function undoConfirmedProposal(deps: ChatServiceDeps, id: string): Promise<ProposalDto> {
	const current = await loadProposal(deps, id);
	const claimed = await transition(deps, id, "confirmed", "undone");
	if (!claimed) throw alreadyAnswered(current, "desfazer");
	try {
		await undoProposal(claimed.kind, claimed.result, createAgentWriter(deps.stores, deps.now));
		return toProposalDto(claimed);
	} catch (error) {
		await transition(deps, id, "undone", "confirmed");
		if (error instanceof ToolError) throw new DataError("invalid", error.message);
		throw error;
	}
}

// ------------------------------------------------------------ histórico

/** Cards que o app mostra, com a situação ATUAL das propostas (a mensagem guarda só o id). */
export async function hydrateMessages(
	deps: ChatServiceDeps,
	rows: ChatMessageRecord[],
): Promise<ChatMessageDto[]> {
	const ids = new Set<string>();
	for (const row of rows) {
		for (const card of row.cards) {
			const proposalId = (card as { proposal?: { id?: unknown } }).proposal?.id;
			if (typeof proposalId === "string") ids.add(proposalId);
		}
	}
	const live = new Map((await deps.stores.chat.getProposals([...ids])).map((p) => [p.id, p]));
	return rows.map((row) => ({
		id: row.id,
		role: row.role,
		text: row.text,
		createdAt: row.createdAt.toISOString(),
		cards: row.cards.flatMap((raw): ChatCard[] => {
			const parsed = chatCardSchema.safeParse(raw);
			if (!parsed.success) return [];
			if (parsed.data.type !== "proposal") return [parsed.data];
			const current = live.get(parsed.data.proposal.id);
			return current ? [{ type: "proposal", proposal: toProposalDto(current) }] : [];
		}),
	}));
}

/** O que o modelo vê do histórico: texto das mensagens mais uma linha por card (consulta feita, proposta e sua situação). */
export function toModelHistory(messages: ChatMessageDto[]): ModelMessage[] {
	const out: ModelMessage[] = [];
	for (const m of messages) {
		const notes = m.cards.map((card) =>
			card.type === "rows"
				? `[consulta mostrada ao dono: ${card.title}]`
				: `[proposta "${card.proposal.title}" ${STATUS_PT[card.proposal.status]}${
						card.proposal.transactionId ? `; lançamento ${card.proposal.transactionId}` : ""
					}]`,
		);
		const content = [m.text, ...notes].filter((part) => part.trim().length > 0).join("\n");
		if (content.length === 0) continue;
		// A conversa para o modelo começa sempre por uma mensagem do dono.
		if (out.length === 0 && m.role !== "user") continue;
		out.push({ role: m.role, content });
	}
	return out;
}

// -------------------------------------------------------------------- turno

export interface ChatTurnInput {
	conversationId?: string | undefined;
	/** Ausente na tarefa fixa (`intent`). */
	message?: string | undefined;
	/** "Configurar com a Órbita": a tarefa vem do servidor, não do que o dono digitou. */
	intent?: "setup" | undefined;
	ownerName: string | null;
	emit: (
		event: AgentEvent | { type: "meta"; conversationId: string; model?: string },
	) => void | Promise<void>;
	signal?: AbortSignal;
}

export interface ChatTurnPreflight {
	/** `null` só na tarefa de configuração sem chave ou acima do limite: o servidor monta a lista sozinho, sem IA. */
	apiKey: string | null;
	/** Por que a configuração foi montada sem IA (pt-BR), ou `null` quando há IA. */
	templateReason: string | null;
	conversationId: string | null;
	/** Agente da conversa (o da conversa existente, ou o pedido numa conversa nova); `null` = Órbita. */
	agent: AgentRecord | null;
}

const TEMPLATE_REASONS = {
	[CHAT_ERROR_CODES.noKey]: "Sem a chave da Anthropic cadastrada, montei a lista sem IA.",
	[CHAT_ERROR_CODES.unreadableKey]: "Não consegui abrir a chave da Anthropic, então montei a lista sem IA.",
	[CHAT_ERROR_CODES.monthlyLimit]: "O limite mensal da IA foi atingido, então montei a lista sem IA.",
} as const;

/**
 * Tudo que pode recusar o pedido ANTES de abrir o fluxo: chave, limite do mês e conversa existente. Na tarefa de
 * configuração (`setup`) a falta de chave ou o limite não recusam: o servidor monta a lista sozinho, sem IA.
 */
export async function preflightChat(
	deps: ChatServiceDeps,
	conversationId: string | undefined,
	agentId?: string | undefined,
	options: { setup?: boolean } = {},
): Promise<ChatTurnPreflight> {
	const conversation =
		conversationId === undefined ? null : await deps.stores.chat.getConversation(conversationId);
	if (conversationId !== undefined && !conversation) {
		throw new DataError("not_found", "Conversa não encontrada.");
	}
	// Numa conversa que já existe, vale o agente com que ela foi aberta (o papel não muda no meio).
	const wantedAgentId = conversation ? conversation.agentId : (agentId ?? null);
	const agent = wantedAgentId === null ? null : await deps.stores.agents.get(wantedAgentId);
	if (wantedAgentId !== null && !agent) throw new DataError("not_found", "Agente não encontrado.");
	try {
		const apiKey = await requireApiKey(deps.vault);
		const blocked = await budgetBlock(deps);
		if (blocked) throw new ChatPreconditionError(403, CHAT_ERROR_CODES.monthlyLimit, blocked);
		return { apiKey, templateReason: null, conversationId: conversationId ?? null, agent };
	} catch (error) {
		if (options.setup !== true || !(error instanceof ChatPreconditionError)) throw error;
		const reason =
			TEMPLATE_REASONS[error.code as keyof typeof TEMPLATE_REASONS] ?? TEMPLATE_REASONS.sem_chave_anthropic;
		return { apiKey: null, templateReason: reason, conversationId: null, agent: null };
	}
}

/** Uma volta do chat: grava a mensagem do dono, roda o agente e grava a resposta. Devolve o id da resposta. */
export async function runChatTurn(
	deps: ChatServiceDeps,
	pre: ChatTurnPreflight,
	input: ChatTurnInput,
): Promise<{ messageId: string }> {
	const { stores } = deps;
	const setup = input.intent === "setup";
	// Na tarefa fixa, o que aparece como fala do dono é o rótulo do botão, e o que o modelo recebe é o texto da tarefa.
	const shown = setup ? SETUP_USER_MESSAGE : (input.message ?? "");
	const conversation =
		pre.conversationId === null
			? await stores.chat.createConversation(shown, { agentId: pre.agent?.id ?? null })
			: await stores.chat.getConversation(pre.conversationId);
	if (!conversation) throw new DataError("not_found", "Conversa não encontrada.");

	const before = await stores.chat.listMessages(conversation.id, { lastN: HISTORY_MESSAGES });
	const history = toModelHistory(await hydrateMessages(deps, before));
	await stores.chat.appendMessage(conversation.id, { role: "user", text: shown });

	const today = toLocalDate(deps.now());
	const month = monthOf(today);
	const reader = createAgentReader(stores, deps.now);
	let catalog: ReturnType<typeof reader.catalog> | undefined;

	// Sem IA (sem chave ou acima do limite): a mesma análise do engine, com os nomes do banco limpos.
	if (setup && pre.apiKey === null) {
		return runTemplateSetup(deps, conversation.id, reader, pre.templateReason, input);
	}
	if (pre.apiKey === null) {
		throw new ChatPreconditionError(409, CHAT_ERROR_CODES.noKey, TEMPLATE_REASONS[CHAT_ERROR_CODES.noKey]);
	}

	// O que o dono escolheu no app vence; sem escolha, valem as variáveis de ambiente (`deps.models`).
	const models = resolveChatModels(deps.models, await stores.aiUsage.getModelChoice());
	// "Conversar com o agente": o papel e só as ferramentas dele. Sem agente (ou a Órbita), valem todas.
	// A tarefa de configuração tem o próprio papel e só as três ferramentas dela.
	const persona = setup
		? resolveSetupPersona()
		: pre.agent
			? resolvePersona(pre.agent)
			: { roleText: "", tools: ALL_TOOLS };
	// O modelo escolhido para o agente vale; senão, a mesma escolha do chat (o barato só na Órbita, em pergunta curta).
	const picked = pickModel(models, { text: shown, isFirstMessage: before.length === 0 });
	const { model, effort } = setup
		? { model: models.main, effort: models.effort }
		: pre.agent?.model && isMainModel(pre.agent.model)
			? { model: pre.agent.model, effort: models.effort }
			: pre.agent && pre.agent.builtinKey !== "orbita"
				? { model: models.main, effort: models.effort }
				: picked;
	await input.emit({ type: "meta", conversationId: conversation.id, model });

	const result = await runAgent(
		{
			client: deps.createClient(pre.apiKey),
			tools: persona.tools,
			toolContext: {
				today,
				currentMonth: month,
				reader,
				// Contas, cartões e categorias: lidos uma vez por turno.
				catalog: () => {
					catalog ??= reader.catalog();
					return catalog;
				},
			},
			proposals: {
				async create(draft: ProposalDraft) {
					const record = await stores.chat.createProposal(conversation.id, {
						kind: draft.kind,
						payload: { action: draft.payload, title: draft.title, lines: draft.lines },
					});
					return toProposalDto(record);
				},
			},
			async recordUsage({ model: used, usage }) {
				await stores.aiUsage.record({
					conversationId: conversation.id,
					model: used,
					...usage,
					costMicroUsd: costMicroUsd(used, usage),
					at: deps.now(),
				});
			},
			guard: () => budgetBlock(deps),
			onToolError: (name, error) => deps.logError?.(`ferramenta ${name} falhou`, error),
		},
		{
			model,
			effort,
			system: buildAgentSystem({ today, month, ownerName: input.ownerName }, persona.roleText),
			history,
			userText: setup ? SETUP_TASK_TEXT : shown,
			...(input.signal ? { signal: input.signal } : {}),
			// O fluxo pode ter fechado (o app saiu da tela): escrever nele falha em silêncio, o turno segue e é gravado.
			emit: (event) => {
				Promise.resolve(input.emit(event)).catch(() => {});
			},
		},
	);

	const saved = await stores.chat.appendMessage(conversation.id, {
		role: "assistant",
		text: result.text,
		cards: result.cards,
	});
	return { messageId: saved.id };
}

/** "Configurar com a Órbita" sem IA: a análise do engine vira o card com nomes limpos do banco, sem chamar o modelo. */
async function runTemplateSetup(
	deps: ChatServiceDeps,
	conversationId: string,
	reader: ReturnType<typeof createAgentReader>,
	reason: string | null,
	input: ChatTurnInput,
): Promise<{ messageId: string }> {
	const { stores } = deps;
	await input.emit({ type: "meta", conversationId });
	const [analysis, catalog] = await Promise.all([reader.setupAnalysis(), reader.catalog()]);
	const draft = templateSetupDraft(analysis, catalog);
	const months = `${analysis.monthsOfHistory} ${analysis.monthsOfHistory === 1 ? "mês" : "meses"}`;
	const weak = analysis.limitedHistory
		? " O histórico ainda é curto (menos de 3 meses), então o resultado é fraco."
		: "";
	const text = draft
		? `${reason ?? ""} Olhei ${months} do seu histórico e montei a lista abaixo com os nomes que vieram do banco. Edite nomes e categorias, marque o que quiser e toque em Confirmar: nada foi gravado ainda.${weak}`
		: `${reason ?? ""} Olhei ${months} do seu histórico e não achei assinaturas, renda nem estabelecimentos para configurar.${weak} Quando houver mais movimento, é só tocar de novo.`;
	const cards: ChatCard[] = [];
	if (draft) {
		const record = await stores.chat.createProposal(conversationId, {
			kind: draft.kind,
			payload: { action: draft.payload, title: draft.title, lines: draft.lines },
		});
		cards.push({ type: "proposal", proposal: toProposalDto(record) });
	}
	const said = text.trim();
	await input.emit({ type: "text", delta: said });
	for (const card of cards) await input.emit({ type: "card", card });
	const saved = await stores.chat.appendMessage(conversationId, { role: "assistant", text: said, cards });
	return { messageId: saved.id };
}
