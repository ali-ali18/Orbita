import { budgetBefore, monthKeySchema, transactionApiCreateBody } from "@orbita/shared";
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

export async function applyProposal(
	kind: string,
	payload: Record<string, unknown>,
	writer: AgentWriter,
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
	throw invalidPayload();
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
	throw invalidPayload();
}
