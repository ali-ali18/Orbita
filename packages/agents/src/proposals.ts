import {
	budgetBefore,
	fullSelection,
	monthKeySchema,
	resolveSetupSelection,
	type SetupSelection,
	setupProposalSchema,
	setupSelectionSchema,
	setupUndoSchema,
	transactionApiCreateBody,
} from "@orbita/shared";
import { z } from "zod";
import { type AgentWriter, ToolError } from "./backend.ts";

/*
 * Executa e desfaz as propostas de escrita da IA. Só roda depois que o dono confirma no card; o `payload` volta do
 * banco, então é validado de novo aqui (borda). Cada função devolve o `result` que o Desfazer vai precisar.
 */

const createPayload = z.object({ input: transactionApiCreateBody });
const categorizePayload = z.object({ transactionId: z.string().min(1), categoryId: z.string().min(1) });
const confirmPayload = z.object({ transactionId: z.string().min(1) });

const applyPlanPayload = z.object({
	month: monthKeySchema,
	reservePercent: z.number().int().min(0).max(100),
});
const applyPlanResult = z.object({ previous: z.array(budgetBefore) });

const setupResult = z.object({ undo: setupUndoSchema });

const createResult = z.object({ transactionId: z.string().min(1) });
const categorizeResult = z.object({
	transactionId: z.string().min(1),
	previousCategoryId: z.string().nullable(),
	previousEditedByOwner: z.boolean(),
});
const confirmResult = z.object({ transactionId: z.string().min(1), wasPending: z.boolean() });

export interface AppliedProposal {
	/** Guardado na proposta para o Desfazer. */
	result: Record<string, unknown>;
	/** Lançamento criado ou alterado; `null` quando a proposta não mexe em lançamento (plano da renda). */
	transactionId: string | null;
}

const invalidPayload = () => new ToolError("A proposta está corrompida e não pode ser executada.");

/**
 * `selection`: o que o dono deixou marcado no card da proposta `setup` (nomes e categorias editados). Ausente = tudo
 * como foi proposto. Valor, dia e data nunca vêm daqui: ficam os da proposta.
 */
export async function applyProposal(
	kind: string,
	payload: Record<string, unknown>,
	writer: AgentWriter,
	selection?: unknown,
): Promise<AppliedProposal> {
	if (kind === "create_transaction") {
		const parsed = createPayload.safeParse(payload);
		if (!parsed.success) throw invalidPayload();
		const created = await writer.createTransaction(parsed.data.input);
		return { result: { transactionId: created.id }, transactionId: created.id };
	}
	if (kind === "categorize_transaction") {
		const parsed = categorizePayload.safeParse(payload);
		if (!parsed.success) throw invalidPayload();
		const { transactionId, categoryId } = parsed.data;
		const previous = await writer.setCategory(transactionId, categoryId);
		return { result: { transactionId, ...previous }, transactionId };
	}
	if (kind === "confirm_transaction") {
		const parsed = confirmPayload.safeParse(payload);
		if (!parsed.success) throw invalidPayload();
		const { transactionId } = parsed.data;
		const { wasPending } = await writer.confirmTransaction(transactionId);
		return { result: { transactionId, wasPending }, transactionId };
	}
	if (kind === "apply_plan") {
		const parsed = applyPlanPayload.safeParse(payload);
		if (!parsed.success) throw invalidPayload();
		const { previous } = await writer.applyPlan(parsed.data.month, parsed.data.reservePercent);
		return { result: { previous }, transactionId: null };
	}
	if (kind === "setup") {
		const parsed = setupProposalSchema.safeParse(payload);
		if (!parsed.success) throw invalidPayload();
		const chosen: SetupSelection | { error: string } =
			selection === undefined ? fullSelection(parsed.data) : parseSelection(selection);
		if ("error" in chosen) throw new ToolError(chosen.error);
		const resolved = resolveSetupSelection(parsed.data, chosen);
		if (!resolved.ok) throw new ToolError(resolved.message);
		const undo = await writer.applySetup(resolved.input);
		// `applied` é o que o card mostra depois (só o aplicado, com os nomes finais); `undo` é para o Desfazer.
		return { result: { applied: chosen, undo }, transactionId: null };
	}
	throw invalidPayload();
}

function parseSelection(raw: unknown): SetupSelection | { error: string } {
	const parsed = setupSelectionSchema.safeParse(raw);
	return parsed.success ? parsed.data : { error: "A seleção enviada é inválida." };
}

/** Desfaz o que `applyProposal` fez. Não lança por "já estava assim": o Desfazer repetido não pode falhar. */
export async function undoProposal(
	kind: string,
	result: Record<string, unknown> | null,
	writer: AgentWriter,
): Promise<void> {
	if (kind === "create_transaction") {
		const parsed = createResult.safeParse(result);
		if (!parsed.success) throw invalidPayload();
		await writer.deleteTransaction(parsed.data.transactionId);
		return;
	}
	if (kind === "categorize_transaction") {
		const parsed = categorizeResult.safeParse(result);
		if (!parsed.success) throw invalidPayload();
		const r = parsed.data;
		await writer.restoreCategory(r.transactionId, r.previousCategoryId, r.previousEditedByOwner);
		return;
	}
	if (kind === "confirm_transaction") {
		const parsed = confirmResult.safeParse(result);
		if (!parsed.success) throw invalidPayload();
		// Se já estava confirmado antes da proposta, não havia nada a desfazer.
		if (parsed.data.wasPending) await writer.revertConfirmation(parsed.data.transactionId);
		return;
	}
	if (kind === "apply_plan") {
		const parsed = applyPlanResult.safeParse(result);
		if (!parsed.success) throw invalidPayload();
		await writer.restoreBudgets(parsed.data.previous);
		return;
	}
	if (kind === "setup") {
		const parsed = setupResult.safeParse(result);
		if (!parsed.success) throw invalidPayload();
		await writer.undoSetup(parsed.data.undo);
		return;
	}
	throw invalidPayload();
}
