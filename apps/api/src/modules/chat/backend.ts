import type { AgentWriter } from "@orbita/agents";
import { monthOf, toLocalDate } from "@orbita/core";
import { DataError, type Stores } from "@orbita/db";
import { applyIncomePlan, applySetup, restoreBudgets, undoSetup } from "@orbita/ledger";
import { orNotFound } from "../../http/errors.ts";
import {
	confirmTransaction,
	createTransaction,
	deleteTransaction,
	updateTransaction,
} from "../transactions/service.ts";

export { createAgentReader } from "@orbita/ledger";

export function createAgentWriter(stores: Stores, now: () => Date): AgentWriter {
	return {
		async createTransaction(input) {
			const created = await createTransaction(stores, input);
			return { id: created.id };
		},
		async setCategory(id, categoryId) {
			const current = orNotFound(await stores.transactions.get(id), "Lançamento", "o");
			await updateTransaction(stores, id, { categoryId });
			return { previousCategoryId: current.categoryId, previousEditedByOwner: current.categoryEditedByOwner };
		},
		async restoreCategory(id, categoryId, editedByOwner) {
			// Se o dono apagou o lançamento depois, não há o que restaurar.
			if (!(await stores.transactions.get(id))) return;
			await stores.transactions.update(id, { categoryId, categoryEditedByOwner: editedByOwner });
		},
		async confirmTransaction(id) {
			const current = orNotFound(await stores.transactions.get(id), "Lançamento", "o");
			await confirmTransaction(stores, id);
			return { wasPending: current.status === "pending" };
		},
		async revertConfirmation(id) {
			if (!(await stores.transactions.get(id))) return;
			await stores.transactions.update(id, { status: "pending" });
		},
		async deleteTransaction(id) {
			try {
				return (await deleteTransaction(stores, id, "item")) > 0;
			} catch (error) {
				// Já apagado pelo dono: o Desfazer repetido não falha.
				if (error instanceof DataError && error.code === "not_found") return false;
				throw error;
			}
		},
		async applyPlan(month, reservePercent) {
			// O dono já viu no card quantos limites seriam trocados e confirmou: aqui a confirmação vale.
			const { previous } = await applyIncomePlan(stores, month, toLocalDate(now()), {
				reservePercent,
				confirm: true,
			});
			return { previous };
		},
		restoreBudgets: (previous) => restoreBudgets(stores, previous),
		applySetup: (input) => applySetup(stores, input, toLocalDate(now())),
		undoSetup: (undo) => undoSetup(stores, undo),
	};
}

/** Mês de hoje no fuso de São Paulo. */
export const currentMonthOf = (now: () => Date) => monthOf(toLocalDate(now()));
