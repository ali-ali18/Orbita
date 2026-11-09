import type { LocalDate } from "@orbita/core";
import type { ActivityDto, SavingsListResponse, SavingsOpportunityDto } from "@orbita/shared";
import { money } from "../../lib/format.ts";
import { whenLabel } from "./agents-model.ts";

/*
 * Lógica pura da parte "Economia" do agente: o seletor de autonomia, a lista "Onde cortar" e o registro de atividades.
 * Todo número vem pronto do servidor (engine); aqui só se escolhe o que mostrar e com que palavras.
 */

export type Autonomy = SavingsListResponse["autonomy"];

export const AUTONOMY_OPTIONS: ReadonlyArray<{ id: Autonomy; label: string; caption: string }> = [
	{ id: "notify", label: "Só avisar", caption: "Mostro onde cortar e você decide." },
	{
		id: "reversible",
		label: "Agir no que é reversível",
		caption: "Faço o que tem Desfazer e deixo tudo no registro.",
	},
];

/** O que o nível "reversível" faz sozinho (a lista fechada do servidor). */
export const REVERSIBLE_DOES: readonly string[] = [
	"Categorizo lançamentos sem categoria",
	"Cadastro assinaturas que tenho certeza",
	"Crio limite de orçamento onde não há",
	"Marco cobrança repetida para você revisar",
	"Crio uma meta de economia",
];

export const NEVER_DOES = "Nunca apago lançamentos, movo dinheiro, pago contas nem mudo o que você editou.";

export const CONFIRM_REVERSIBLE = {
	title: "Agir sozinho no que é reversível?",
	message: `${REVERSIBLE_DOES.join(". ")}. Tudo fica no registro, com Desfazer. ${NEVER_DOES}`,
	confirmLabel: "Permitir",
} as const;

/** A escolha salva, com o padrão seguro (só avisar) para qualquer valor estranho. */
export function autonomyOf(settings: Record<string, unknown>): Autonomy {
	return settings.autonomy === "reversible" ? "reversible" : "notify";
}

export const autonomyLabel = (autonomy: Autonomy): string =>
	AUTONOMY_OPTIONS.find((o) => o.id === autonomy)?.label ?? "Só avisar";

// ----------------------------------------------------------------- onde cortar

export const CONFIDENCE_LABEL: Record<SavingsOpportunityDto["confidence"], string> = {
	high: "Alta confiança",
	medium: "Confiança média",
	low: "Estimativa",
};

export const SAVINGS_EMPTY = "Nada a cortar por enquanto. Eu volto a olhar na próxima passada.";
export const SAVINGS_EMPTY_NOTE = "Aqui só entra o que os seus lançamentos mostram, nunca palpite.";

/** Quantos achados aparecem de cara; o resto fica atrás de "Ver todos". */
export const SAVINGS_SHOWN = 4;

export function visibleOpportunities<T>(list: readonly T[], expanded: boolean): T[] {
	return expanded ? [...list] : list.slice(0, SAVINGS_SHOWN);
}

/** "Dá para cortar até R$ 27,90 por mês", ou nada quando só há avisos sem economia. */
export function savingsHeadline(total: number, hidden: boolean): string | null {
	return total > 0 ? `Dá para cortar até ${money(total, hidden, { sign: "never" })} por mês` : null;
}

/** O valor de um achado: "R$ 17,90" com "por mês", ou "Atenção" quando é um risco sem economia. */
export function opportunityValue(
	o: Pick<SavingsOpportunityDto, "monthlySavingsCents">,
	hidden: boolean,
): { value: string; caption: string } {
	return o.monthlySavingsCents > 0
		? { value: money(o.monthlySavingsCents, hidden, { sign: "never" }), caption: "por mês" }
		: { value: "Atenção", caption: "sem economia" };
}

/** Achados que não somam no total (sobrepõem outros) levam um aviso curto. */
export const OVERLAP_NOTE = "Não soma no total: já está em outros itens.";

export function actionsOf(o: SavingsOpportunityDto): {
	primary: SavingsOpportunityDto["actions"][number] | null;
} {
	return { primary: o.actions.find((a) => a.id !== "ignore") ?? null };
}

// -------------------------------------------------------------------- registro

export const ACTIVITY_KIND_LABEL: Record<ActivityDto["kind"], string> = {
	categorize_transaction: "Categoria",
	register_subscription: "Assinatura",
	set_budget_limit: "Limite",
	flag_duplicate: "Para revisar",
	create_savings_goal: "Meta",
};

export const ACTIVITY_EMPTY = "O que eu fizer sozinho aparece aqui, com o motivo e o botão Desfazer.";
export const ACTIVITY_EMPTY_NOTIFY = "No nível Só avisar eu não faço nada sozinho.";

/** Hora do registro: "Agora", "09:30" no mesmo dia ou "8 de nov". */
export const activityWhen = (a: Pick<ActivityDto, "createdAt">, now: Date, today: LocalDate): string =>
	whenLabel(a.createdAt, now, today);

/** O que a linha mostra no lugar do botão quando a atividade já foi desfeita. */
export function undoneLabel(a: Pick<ActivityDto, "status" | "undoNote">): string | null {
	if (a.status !== "undone") return null;
	return a.undoNote ?? "Desfeito";
}
