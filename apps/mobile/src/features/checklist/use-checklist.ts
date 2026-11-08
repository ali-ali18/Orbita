import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { getItem, KEYS, setItem } from "../../lib/storage.ts";
import { usePluggyStatusSnapshot } from "../banks/queries.ts";
import { totalLimit } from "../budget/budget-model.ts";
import { useBudgets } from "../budget/queries.ts";
import { CHECKLIST_DISMISSED, type ChecklistFacts, isDismissed } from "./checklist-model.ts";

/** `null` enquanto o cofre não respondeu. Falha de leitura vale como "não dispensou". */
export function useChecklistDismissed(): { dismissed: boolean | null; dismiss: () => void } {
	const [dismissed, setDismissed] = useState<boolean | null>(null);
	useEffect(() => {
		let cancelled = false;
		getItem(KEYS.checklistDismissed)
			.then((value) => !cancelled && setDismissed(isDismissed(value)))
			.catch(() => !cancelled && setDismissed(false));
		return () => {
			cancelled = true;
		};
	}, []);
	const dismiss = () => {
		setDismissed(true);
		void setItem(KEYS.checklistDismissed, CHECKLIST_DISMISSED).catch(() => {});
	};
	return { dismissed, dismiss };
}

/** Só lê o interruptor da digital (quem liga e desliga é a tela de Configurações). Relê ao voltar para o Início. */
function useBiometricOn(): boolean | undefined {
	const [on, setOn] = useState<boolean | undefined>(undefined);
	useFocusEffect(
		useCallback(() => {
			let cancelled = false;
			getItem(KEYS.biometricLock)
				.then((value) => !cancelled && setOn(value === "1"))
				.catch(() => !cancelled && setOn(false));
			return () => {
				cancelled = true;
			};
		}, []),
	);
	return on;
}

/** O que o app sabe para os primeiros passos. Reaproveita consultas que o Início já faz (cache compartilhado). */
export function useChecklistFacts(transactionCount: number | undefined): ChecklistFacts {
	const pluggy = usePluggyStatusSnapshot();
	const budgets = useBudgets();
	const biometricOn = useBiometricOn();
	return {
		connectionCount: pluggy.data?.connections.length,
		hasBudget: budgets.data ? totalLimit(budgets.data.budgets) !== null : undefined,
		transactionCount,
		biometricOn,
	};
}
