/*
 * Primeiros passos do Início (Figma 55:1138). Cada item vem de dado de verdade, nunca de um "já fiz" digitado:
 * o servidor conectado (há sessão), banco conectado, orçamento definido, primeiro lançamento e a digital ligada.
 * A leitura de notificações do Figma fica de fora: o app ainda não tem esse módulo, então não há o que derivar.
 */

export type ChecklistItemId = "server" | "bank" | "budget" | "firstTransaction" | "biometric";

export type ChecklistHref =
	| "/configuracoes/servidor"
	| "/configuracoes/bancos"
	| "/configuracoes/orcamento"
	| "/novo"
	| "/configuracoes";

/** O que o app sabe hoje. `undefined` = ainda não carregou (não conta como feito nem como pendente). */
export interface ChecklistFacts {
	connectionCount: number | undefined;
	hasBudget: boolean | undefined;
	transactionCount: number | undefined;
	biometricOn: boolean | undefined;
}

export interface ChecklistItem {
	id: ChecklistItemId;
	title: string;
	done: boolean;
	href: ChecklistHref;
}

export interface Checklist {
	items: ChecklistItem[];
	doneCount: number;
	total: number;
	complete: boolean;
}

const ITEMS: readonly { id: ChecklistItemId; title: string; href: ChecklistHref }[] = [
	{ id: "server", title: "Conectar ao servidor", href: "/configuracoes/servidor" },
	{ id: "bank", title: "Conectar um banco", href: "/configuracoes/bancos" },
	{ id: "budget", title: "Definir o orçamento do mês", href: "/configuracoes/orcamento" },
	{ id: "firstTransaction", title: "Lançar o primeiro gasto", href: "/novo" },
	{ id: "biometric", title: "Proteger o app com a digital", href: "/configuracoes" },
];

/** Está no app, então o servidor está conectado: é o único item que não depende de consulta. */
export function deriveChecklist(facts: ChecklistFacts): Checklist {
	const done: Record<ChecklistItemId, boolean> = {
		server: true,
		bank: (facts.connectionCount ?? 0) > 0,
		budget: facts.hasBudget === true,
		firstTransaction: (facts.transactionCount ?? 0) > 0,
		biometric: facts.biometricOn === true,
	};
	const items = ITEMS.map((item) => ({ ...item, done: done[item.id] }));
	const doneCount = items.filter((i) => i.done).length;
	return { items, doneCount, total: items.length, complete: doneCount === items.length };
}

/** Só decide com tudo carregado: o que falta carregar faria a lista piscar completa ou vazia. */
export function factsLoaded(facts: ChecklistFacts): boolean {
	return (
		facts.connectionCount !== undefined &&
		facts.hasBudget !== undefined &&
		facts.transactionCount !== undefined &&
		facts.biometricOn !== undefined
	);
}

/** Mostra enquanto falta passo e a pessoa não dispensou. `dismissed` nulo = ainda lendo o cofre. */
export function shouldShowChecklist(
	facts: ChecklistFacts,
	dismissed: boolean | null,
): { show: boolean; checklist: Checklist } {
	const checklist = deriveChecklist(facts);
	return { show: factsLoaded(facts) && dismissed === false && !checklist.complete, checklist };
}

/** Sem nenhum lançamento o Início ainda não tem o que mostrar: entra o cartão "Ainda estou aprendendo". */
export function isFirstUse(transactionCount: number | undefined): boolean {
	return transactionCount === 0;
}

export function progressText(checklist: Pick<Checklist, "doneCount" | "total">): string {
	return `${checklist.doneCount} de ${checklist.total} ${checklist.doneCount === 1 ? "concluído" : "concluídos"}`;
}

/** "1" no cofre quando a pessoa fechou a lista. Qualquer outro valor (ou ausência): não dispensou. */
export const CHECKLIST_DISMISSED = "1";
export const isDismissed = (stored: string | null): boolean => stored === CHECKLIST_DISMISSED;

export const EMPTY_HERO_TITLE = "Ainda estou aprendendo seus números";
export const EMPTY_HERO_BODY = "Falta pouco. Termine estes passos e eu monto o resto.";
export const EMPTY_HOME_CAPTION = "Seu painel aparece aqui assim que chegarem os primeiros lançamentos.";
export const DISMISS_LABEL = "Dispensar";
