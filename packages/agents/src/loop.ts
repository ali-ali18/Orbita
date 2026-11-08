import type { ChatCard, ChatRowsCard, ProposalDto } from "@orbita/shared";
import {
	addUsage,
	type Effort,
	isTextBlock,
	isToolUseBlock,
	type ModelBlock,
	type ModelClient,
	type ModelMessage,
	type ModelUsage,
	type SystemBlock,
	ZERO_USAGE,
} from "./model.ts";
import type { ProposalDraft, Tool, ToolContext } from "./tool.ts";
import { toolSchemas } from "./tools.ts";

/*
 * O laço de conversa, escrito à mão (em vez do Tool Runner do SDK) porque o servidor precisa de controle em cada
 * volta: checar o limite de gasto ANTES de cada chamada, registrar o custo de CADA chamada, interceptar as
 * propostas de escrita e transmitir texto e cards ao app no meio do caminho. O modelo entra por `ModelClient`,
 * então os testes usam um cliente falso.
 */

export type AgentEvent =
	| { type: "text"; delta: string }
	| { type: "tool"; name: string; label: string }
	| { type: "card"; card: ChatCard };

/** Onde as propostas de escrita são registradas (o servidor grava no banco e devolve o card). */
export interface ProposalSink {
	create(draft: ProposalDraft): Promise<ProposalDto>;
}

export interface AgentLoopDeps {
	client: ModelClient;
	tools: readonly Tool[];
	toolContext: ToolContext;
	proposals: ProposalSink;
	/** Chamado depois de CADA chamada ao modelo, com o uso real. */
	recordUsage(entry: { model: string; usage: ModelUsage }): Promise<void>;
	/** Antes de cada chamada: texto de bloqueio (ex.: limite mensal) para parar, ou `null` para seguir. */
	guard?: () => Promise<string | null>;
	/** Falhas inesperadas de ferramenta (vão para o log do servidor; o modelo só vê uma mensagem genérica). */
	onToolError?: (name: string, error: unknown) => void;
}

export interface AgentRunInput {
	model: string;
	effort?: Effort | undefined;
	system: SystemBlock[];
	/** Conversa anterior, já no formato do modelo. */
	history: ModelMessage[];
	userText: string;
	maxTokens?: number;
	/** Teto de voltas modelo → ferramentas → modelo. */
	maxIterations?: number;
	signal?: AbortSignal;
	emit?: (event: AgentEvent) => void;
}

export type AgentStop = "end_turn" | "max_tokens" | "refusal" | "max_iterations" | "blocked";

export interface AgentRunResult {
	text: string;
	cards: ChatCard[];
	stop: AgentStop;
	usage: ModelUsage;
}

export const DEFAULT_MAX_TOKENS = 4096;
export const DEFAULT_MAX_ITERATIONS = 8;
/** Resultado de ferramenta maior que isto é recusado (o modelo deve filtrar mais). */
const MAX_TOOL_RESULT_CHARS = 30_000;

const REFUSAL_TEXT = "Não posso ajudar com esse pedido.";
const TRUNCATED_TEXT = "A resposta ficou grande demais e foi cortada. Pergunte de um jeito mais específico.";
const TOO_MANY_STEPS_TEXT =
	"Precisei de passos demais para responder. Tente dividir o pedido em partes menores.";
const GENERIC_TOOL_ERROR = "Não consegui consultar isso agora.";

const isExpectedError = (error: unknown): error is Error =>
	error instanceof Error && (error.name === "ToolError" || error.name === "DataError");

function describeZodIssue(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string {
	const issue = error.issues[0];
	if (!issue) return "Entrada inválida.";
	const field = issue.path.map(String).join(".");
	return field ? `Entrada inválida em "${field}": ${issue.message}` : `Entrada inválida: ${issue.message}`;
}

interface ToolResultBlock {
	type: "tool_result";
	tool_use_id: string;
	content: string;
	is_error?: boolean;
}

export async function runAgent(deps: AgentLoopDeps, input: AgentRunInput): Promise<AgentRunResult> {
	const schemas = toolSchemas(deps.tools);
	const messages: ModelMessage[] = [...input.history, { role: "user", content: input.userText }];
	const cards: ChatCard[] = [];
	const emit = input.emit ?? (() => {});
	let text = "";
	let usage = ZERO_USAGE;
	const maxIterations = input.maxIterations ?? DEFAULT_MAX_ITERATIONS;

	const say = (delta: string) => {
		if (!delta) return;
		text += delta;
		emit({ type: "text", delta });
	};
	const pushCard = (card: ChatCard) => {
		cards.push(card);
		emit({ type: "card", card });
	};

	for (let step = 0; step < maxIterations; step += 1) {
		const blocked = await deps.guard?.();
		if (blocked) {
			say(text ? `\n\n${blocked}` : blocked);
			return { text, cards, stop: "blocked", usage };
		}

		let separator = text ? "\n\n" : "";
		const response = await deps.client.turn(
			{
				model: input.model,
				maxTokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
				system: input.system,
				tools: schemas,
				messages,
				...(input.effort ? { effort: input.effort } : {}),
			},
			{
				onText: (delta) => {
					// Texto de uma volta nova (depois de ferramentas) não cola no da anterior.
					say(separator + delta);
					separator = "";
				},
			},
			input.signal,
		);
		usage = addUsage(usage, response.usage);
		await deps.recordUsage({ model: response.model, usage: response.usage });

		// O conteúdo volta ao modelo exatamente como veio (blocos de raciocínio incluídos).
		messages.push({ role: "assistant", content: response.content });

		if (response.stopReason === "tool_use") {
			const calls = response.content.filter(isToolUseBlock);
			const results: ToolResultBlock[] = [];
			for (const call of calls) {
				const tool = deps.tools.find((t) => t.name === call.name);
				if (tool) emit({ type: "tool", name: tool.name, label: tool.label });
				results.push(await runTool(deps, tool, call, pushCard));
			}
			messages.push({ role: "user", content: results as unknown as ModelBlock[] });
			continue;
		}

		if (response.stopReason === "refusal") {
			say(text ? `\n\n${REFUSAL_TEXT}` : REFUSAL_TEXT);
			return { text, cards, stop: "refusal", usage };
		}
		if (response.stopReason === "max_tokens") {
			say(text ? `\n\n${TRUNCATED_TEXT}` : TRUNCATED_TEXT);
			return { text, cards, stop: "max_tokens", usage };
		}
		// Sem texto nenhum (ex.: só ferramentas e silêncio), o dono ainda recebe uma resposta.
		if (!response.content.some(isTextBlock) && !text && cards.length === 0) {
			say("Não consegui montar uma resposta. Pode reformular?");
		}
		return { text, cards, stop: "end_turn", usage };
	}

	say(text ? `\n\n${TOO_MANY_STEPS_TEXT}` : TOO_MANY_STEPS_TEXT);
	return { text, cards, stop: "max_iterations", usage };
}

async function runTool(
	deps: AgentLoopDeps,
	tool: Tool | undefined,
	call: { id: string; name: string; input: unknown },
	pushCard: (card: ChatCard) => void,
): Promise<ToolResultBlock> {
	const fail = (message: string): ToolResultBlock => ({
		type: "tool_result",
		tool_use_id: call.id,
		content: JSON.stringify({ erro: message }),
		is_error: true,
	});
	if (!tool) return fail(`A ferramenta "${call.name}" não existe.`);

	const parsed = tool.input.safeParse(call.input);
	if (!parsed.success) return fail(describeZodIssue(parsed.error));

	try {
		const output = await tool.run(parsed.data, deps.toolContext);
		const data: Record<string, unknown> = { ...output.data };
		if (output.proposal) {
			// A escrita só vira proposta registrada; o card pede a confirmação do dono.
			const proposal = await deps.proposals.create(output.proposal);
			data.proposalId = proposal.id;
			pushCard({ type: "proposal", proposal });
		}
		if (output.card) pushCard(output.card satisfies ChatRowsCard);
		const content = JSON.stringify(data);
		if (content.length > MAX_TOOL_RESULT_CHARS) {
			return fail("O resultado é grande demais. Refine o filtro (período, categoria ou estabelecimento).");
		}
		return { type: "tool_result", tool_use_id: call.id, content };
	} catch (error) {
		if (isExpectedError(error)) return fail(error.message);
		deps.onToolError?.(call.name, error);
		return fail(GENERIC_TOOL_ERROR);
	}
}
