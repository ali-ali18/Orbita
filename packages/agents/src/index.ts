/*
 * API pública de @orbita/agents. Quem constrói um agente novo (Vigia, Fechamento…) usa só isto:
 *
 *   - ferramentas:   ALL_TOOLS / READ_TOOLS / WRITE_TOOLS, toolSchemas, findTool, defineTool
 *   - laço:          runAgent(deps, input)  (cliente do modelo, ferramentas, custo e propostas injetados)
 *   - modelo:        ModelClient (porta), createAnthropicModelClient (SDK), describeModelError
 *   - prompt:        buildSystem, STABLE_PROMPT
 *   - custo:         costMicroUsd, MODEL_PRICES
 *   - escrita:       applyProposal / undoProposal (só depois que o dono confirma)
 *   - dados:         AgentReader / AgentWriter (portas que o servidor implementa)
 */

export { type AlertCandidate, collectAlerts, type FindingsPort, settingsFor } from "./alerts/collect.ts";
export {
	CUSTOM_MAX_ITERATIONS,
	type CustomRunDeps,
	type CustomRunInput,
	type CustomRunResult,
	NO_ALERT,
	runCustomAgent,
} from "./alerts/custom.ts";
export { monthLabel } from "./alerts/text.ts";
export { acceptWording, type WordingDeps, type WordingResult, wordAlerts } from "./alerts/wording.ts";
export {
	type AnthropicClientOptions,
	buildParams,
	createAnthropicModelClient,
	describeModelError,
	type ModelErrorInfo,
	type SdkLike,
	type StreamLike,
} from "./anthropic-client.ts";
export {
	type AgentReader,
	type AgentWriter,
	type Catalog,
	type InvoiceData,
	ToolError,
	type TransactionQuery,
} from "./backend.ts";
export {
	type AgentEvent,
	type AgentLoopDeps,
	type AgentRunInput,
	type AgentRunResult,
	type AgentStop,
	DEFAULT_MAX_ITERATIONS,
	DEFAULT_MAX_TOKENS,
	type ProposalSink,
	runAgent,
} from "./loop.ts";
export {
	addUsage,
	type Effort,
	isTextBlock,
	isToolUseBlock,
	type ModelBlock,
	type ModelClient,
	type ModelMessage,
	type ModelRequest,
	type ModelResponse,
	type ModelUsage,
	type SystemBlock,
	type ToolSchema,
	type TurnHandlers,
	ZERO_USAGE,
} from "./model.ts";
export {
	CHAT_MODEL_OPTIONS,
	type ChatModelConfig,
	type ChatModelOption,
	DEFAULT_CHAT_EFFORT,
	DEFAULT_CHAT_MODEL,
	DEFAULT_CHAT_MODEL_CONFIG,
	DEFAULT_FAST_MODEL,
	FAST_MODEL_OFF,
	isFastModelChoice,
	isMainModel,
	pickModel,
	resolveChatModels,
	type SavedChatModels,
} from "./models.ts";
export {
	type AgentPersona,
	BUILTIN_PERSONAS,
	buildAgentSystem,
	type PersonaSource,
	type ResolvedPersona,
	resolvePersona,
} from "./personas.ts";
export {
	costMicroUsd,
	FALLBACK_PRICE,
	listPrice,
	MODEL_PRICES,
	type ModelPrice,
	priceFor,
} from "./pricing.ts";
export { buildContextBlock, buildSystem, type PromptContext, STABLE_PROMPT } from "./prompt.ts";
export { type AppliedProposal, applyProposal, undoProposal } from "./proposals.ts";
export { READ_TOOLS } from "./read-tools.ts";
export {
	defineTool,
	type ProposalDraft,
	type Tool,
	type ToolContext,
	type ToolOutput,
	toolSchema,
} from "./tool.ts";
export { ALL_TOOLS, findTool, toolSchemas } from "./tools.ts";
export { UNTRUSTED_MAX, untrusted } from "./untrusted.ts";
export { WRITE_TOOLS } from "./write-tools.ts";
