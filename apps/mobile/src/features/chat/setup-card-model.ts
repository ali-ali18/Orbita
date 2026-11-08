import { SETUP_NAME_MAX, type SetupProposal, type SetupSelection } from "@orbita/shared";

/*
 * Estado do card "Configurar com a Órbita" (funções puras; o componente só liga isto ao React). O app deixa o dono
 * marcar itens e editar NOME e CATEGORIA. Valor, dia e data aparecem só para leitura e nunca viajam de volta: o
 * servidor usa os da proposta e ainda os confere contra o histórico.
 */

export const SETUP_SECTION_SUBSCRIPTIONS = "Assinaturas encontradas";
export const SETUP_SECTION_RULES = "Categorias";
export const SETUP_SECTION_INCOME = "Renda";
export const SETUP_SECTION_BUDGET = "Orçamento";
export const SETUP_NO_CATEGORY = "Escolher categoria";
export const SETUP_PLAN_TITLE = "Aplicar o plano da renda ao orçamento";
export const SETUP_PLAN_NOTE =
	"A Órbita monta os limites do mês com a sua renda. Troca os limites atuais; dá para desfazer.";
export const SETUP_RETRO_LABEL = "Também nos lançamentos antigos";

export interface SubDraft {
	checked: boolean;
	name: string;
	categoryId: string | null;
}
export interface RuleDraft {
	checked: boolean;
	categoryId: string | null;
	applyToExisting: boolean;
}
export interface SetupDraft {
	subs: Record<string, SubDraft>;
	rules: Record<string, RuleDraft>;
	income: { checked: boolean; name: string } | null;
	plan: { checked: boolean } | null;
}

/** O que a proposta trouxe vem marcado, menos o que ainda não tem categoria (o dono escolhe antes de marcar). */
export function initialDraft(setup: SetupProposal): SetupDraft {
	return {
		subs: Object.fromEntries(
			setup.subscriptions.map((s) => [
				s.key,
				{ checked: s.categoryId !== null, name: s.name, categoryId: s.categoryId },
			]),
		),
		rules: Object.fromEntries(
			setup.categoryRules.map((r) => [
				r.key,
				{ checked: r.categoryId !== null, categoryId: r.categoryId, applyToExisting: r.applyToExisting },
			]),
		),
		income: setup.income ? { checked: true, name: setup.income.name } : null,
		plan: setup.plan ? { checked: true } : null,
	};
}

export type ItemRef =
	| { section: "sub"; key: string }
	| { section: "rule"; key: string }
	| { section: "income" }
	| { section: "plan" };

export function toggleItem(draft: SetupDraft, ref: ItemRef): SetupDraft {
	switch (ref.section) {
		case "sub": {
			const s = draft.subs[ref.key];
			if (!s) return draft;
			// Sem categoria não dá para marcar: o toque abre a escolha (quem chama decide), então aqui nada muda.
			if (!s.checked && s.categoryId === null) return draft;
			return { ...draft, subs: { ...draft.subs, [ref.key]: { ...s, checked: !s.checked } } };
		}
		case "rule": {
			const r = draft.rules[ref.key];
			if (!r || (!r.checked && r.categoryId === null)) return draft;
			return { ...draft, rules: { ...draft.rules, [ref.key]: { ...r, checked: !r.checked } } };
		}
		case "income":
			return draft.income ? { ...draft, income: { ...draft.income, checked: !draft.income.checked } } : draft;
		case "plan":
			return draft.plan ? { ...draft, plan: { checked: !draft.plan.checked } } : draft;
	}
}

/** Escolher a categoria de um item sem categoria também o marca (foi para isso que o dono tocou). */
export function setCategory(draft: SetupDraft, ref: ItemRef, categoryId: string): SetupDraft {
	if (ref.section === "sub") {
		const s = draft.subs[ref.key];
		if (!s) return draft;
		return {
			...draft,
			subs: { ...draft.subs, [ref.key]: { ...s, categoryId, checked: s.checked || s.categoryId === null } },
		};
	}
	if (ref.section === "rule") {
		const r = draft.rules[ref.key];
		if (!r) return draft;
		return {
			...draft,
			rules: { ...draft.rules, [ref.key]: { ...r, categoryId, checked: r.checked || r.categoryId === null } },
		};
	}
	return draft;
}

export function setName(draft: SetupDraft, ref: ItemRef, name: string): SetupDraft {
	if (ref.section === "sub") {
		const s = draft.subs[ref.key];
		return s ? { ...draft, subs: { ...draft.subs, [ref.key]: { ...s, name } } } : draft;
	}
	if (ref.section === "income" && draft.income) return { ...draft, income: { ...draft.income, name } };
	return draft;
}

export function toggleRetro(draft: SetupDraft, key: string): SetupDraft {
	const r = draft.rules[key];
	return r
		? { ...draft, rules: { ...draft.rules, [key]: { ...r, applyToExisting: !r.applyToExisting } } }
		: draft;
}

export function selectedCount(draft: SetupDraft): number {
	return (
		Object.values(draft.subs).filter((s) => s.checked).length +
		Object.values(draft.rules).filter((r) => r.checked).length +
		(draft.income?.checked ? 1 : 0) +
		(draft.plan?.checked ? 1 : 0)
	);
}

export const confirmLabel = (count: number) => `Confirmar selecionados (${count})`;

/** A seleção que vai ao servidor, ou a mensagem do que falta. Só nome, categoria e o que está marcado. */
export function buildSelection(
	setup: SetupProposal,
	draft: SetupDraft,
): { ok: true; selection: SetupSelection } | { ok: false; message: string } {
	const subscriptions: SetupSelection["subscriptions"] = [];
	for (const s of setup.subscriptions) {
		const d = draft.subs[s.key];
		if (!d?.checked) continue;
		const name = d.name.trim();
		if (name === "") return { ok: false, message: "Dê um nome a cada assinatura marcada." };
		if (name.length > SETUP_NAME_MAX)
			return { ok: false, message: `O nome passa de ${SETUP_NAME_MAX} letras.` };
		if (d.categoryId === null) return { ok: false, message: `Escolha a categoria de "${name}".` };
		subscriptions.push({ key: s.key, name, categoryId: d.categoryId });
	}
	const categoryRules: SetupSelection["categoryRules"] = [];
	for (const r of setup.categoryRules) {
		const d = draft.rules[r.key];
		if (!d?.checked) continue;
		if (d.categoryId === null) return { ok: false, message: `Escolha a categoria de "${r.merchant}".` };
		categoryRules.push({ key: r.key, categoryId: d.categoryId, applyToExisting: d.applyToExisting });
	}
	let income: SetupSelection["income"] = null;
	if (draft.income?.checked) {
		const name = draft.income.name.trim();
		if (name === "") return { ok: false, message: "Dê um nome à renda." };
		if (name.length > SETUP_NAME_MAX)
			return { ok: false, message: `O nome passa de ${SETUP_NAME_MAX} letras.` };
		income = { name };
	}
	const applyPlan = draft.plan?.checked === true;
	if (subscriptions.length + categoryRules.length === 0 && income === null && !applyPlan) {
		return { ok: false, message: "Marque pelo menos um item." };
	}
	return { ok: true, selection: { subscriptions, categoryRules, income, applyPlan } };
}

/** "R$ 44,90 · todo dia 10". Texto pronto do servidor; o app só junta. */
export const subscriptionLine = (s: { amountText: string; dayOfMonth: number }) =>
	`${s.amountText} · todo dia ${s.dayOfMonth}`;

export const incomeLine = (i: { amountText: string; payday: number }) =>
	`${i.amountText} · todo dia ${i.payday}`;

export function ruleLine(r: { count: number; totalText: string }): string {
	return `${r.count} ${r.count === 1 ? "lançamento" : "lançamentos"} · ${r.totalText}`;
}

/** "3 cobranças, a última em 10/10". */
export function occurrencesLine(s: { occurrences: number; lastDate: string }): string {
	const [, month, day] = s.lastDate.split("-");
	return `${s.occurrences} cobranças, a última em ${day}/${month}`;
}

/** Depois de confirmar ou desfazer, quase tudo muda no servidor (assinaturas, renda, regras, orçamento, lançamentos). */
export function isAffectedBySetup(queryKey: readonly unknown[], baseUrl: string): boolean {
	return queryKey[0] === baseUrl && queryKey[1] !== "chat" && queryKey[2] !== "ai";
}
