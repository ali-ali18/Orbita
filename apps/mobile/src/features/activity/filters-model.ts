import {
	addDays,
	addMonths,
	type Cents,
	daysInMonth,
	formatBRL,
	isValidLocalDate,
	type LocalDate,
	monthOf,
	parseMonthKey,
} from "@orbita/core";
import { MAX_CENTS, MAX_FILTER_ITEMS, type TransactionSource } from "@orbita/shared";

/*
 * Filtros da gaveta de Atividades (Figma 51:918). Tudo aqui é função pura: estado do formulário (texto como o
 * dono digitou) -> validação -> parâmetros da API (`GET /v1/transactions`). Dinheiro vira centavos inteiros
 * por texto, sem passar por `float`.
 */

export type PeriodPreset = "this-month" | "last-month" | "last-90-days" | "custom";
export type TypeId = "out" | "in" | "transfer" | "invest";
export type StatusId = "confirmed" | "pending";

export const PERIOD_OPTIONS: readonly { id: PeriodPreset; label: string }[] = [
	{ id: "this-month", label: "Este mês" },
	{ id: "last-month", label: "Mês passado" },
	{ id: "last-90-days", label: "3 meses" },
	{ id: "custom", label: "Escolher datas" },
];

/** Saída = despesa; entrada = receita e estorno; transferência inclui o pagamento de fatura (dinheiro que só muda de lugar); investimento é a aplicação, à parte do gasto. */
export const TYPE_OPTIONS: readonly {
	id: TypeId;
	label: string;
	kinds: readonly (
		| "expense"
		| "income"
		| "refund"
		| "transfer"
		| "card_payment"
		| "investment"
		| "redemption"
	)[];
}[] = [
	{ id: "out", label: "Saídas", kinds: ["expense"] },
	{ id: "in", label: "Entradas", kinds: ["income", "refund"] },
	{ id: "transfer", label: "Transferências", kinds: ["transfer", "card_payment"] },
	{ id: "invest", label: "Investimentos", kinds: ["investment", "redemption"] },
];

export const SOURCE_OPTIONS: readonly { id: TransactionSource; label: string }[] = [
	{ id: "manual", label: "Manual" },
	{ id: "pluggy", label: "Meu Pluggy" },
	{ id: "notification", label: "Notificação" },
	{ id: "receipt", label: "Comprovante" },
	{ id: "import", label: "Importação" },
];

export const STATUS_OPTIONS: readonly { id: StatusId; label: string }[] = [
	{ id: "confirmed", label: "Confirmado" },
	{ id: "pending", label: "Pendente" },
];

/** O que o dono marcou na gaveta. Datas e valores ficam como texto (o que está no campo). */
export interface ActivityFilters {
	period: PeriodPreset | null;
	/** "dd/mm/aaaa", só vale com `period === "custom"`. */
	from: string;
	to: string;
	types: TypeId[];
	accountIds: string[];
	cardIds: string[];
	categoryIds: string[];
	sources: TransactionSource[];
	statuses: StatusId[];
	/** Reais como digitados ("12,50"); vazio = sem limite. */
	min: string;
	max: string;
}

export const EMPTY_FILTERS: ActivityFilters = {
	period: null,
	from: "",
	to: "",
	types: [],
	accountIds: [],
	cardIds: [],
	categoryIds: [],
	sources: [],
	statuses: [],
	min: "",
	max: "",
};

// ------------------------------------------------------------ texto -> valor

/**
 * "12,50" -> 1250. Aceita "R$", pontos de milhar ("1.234,56") e ponto decimal ("12.5"). `null` = vazio;
 * `"invalid"` = não é um valor em reais. Nunca usa `float`: separa reais e centavos como texto.
 */
export function parseReais(text: string): Cents | null | "invalid" {
	const raw = text.replace(/R\$/gi, "").replace(/\s/g, "");
	if (raw === "") return null;
	let reais: string;
	let frac = "";
	if (/^\d+(,\d{1,2})?$/.test(raw) || /^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(raw)) {
		const [int = "", dec = ""] = raw.split(",");
		reais = int.replace(/\./g, "");
		frac = dec;
	} else if (/^\d+\.\d{1,2}$/.test(raw)) {
		[reais = "", frac = ""] = raw.split(".");
	} else {
		return "invalid";
	}
	if (reais.replace(/^0+/, "").length > String(MAX_CENTS).length) return "invalid";
	const cents = Number(reais) * 100 + Number(frac.padEnd(2, "0"));
	return Number.isSafeInteger(cents) && cents <= MAX_CENTS ? cents : "invalid";
}

/** "12/11/2026" -> "2026-11-12"; `null` se vazio ou data que não existe. */
export function parseBrDate(text: string): LocalDate | null {
	const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
	if (!m) return null;
	const iso = `${m[3]}-${m[2]}-${m[1]}`;
	return isValidLocalDate(iso) ? iso : null;
}

/** Máscara enquanto digita: só dígitos, "12112026" -> "12/11/2026". */
export function maskBrDate(text: string): string {
	const d = text.replace(/\D/g, "").slice(0, 8);
	if (d.length <= 2) return d;
	if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
	return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

/** "2026-11-12" -> "12/11/2026". */
export function toBrDate(date: LocalDate): string {
	return `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
}

// ---------------------------------------------------------------- período

/** Intervalo de datas (inclusivo) de um período fixo. `custom` não tem: vem dos campos de data. */
export function periodRange(
	period: Exclude<PeriodPreset, "custom">,
	today: LocalDate,
): { from: LocalDate; to: LocalDate } {
	if (period === "last-90-days") return { from: addDays(today, -89), to: today };
	const month = period === "this-month" ? monthOf(today) : addMonths(monthOf(today), -1);
	const { year, month: m } = parseMonthKey(month);
	return { from: `${month}-01`, to: `${month}-${String(daysInMonth(year, m)).padStart(2, "0")}` };
}

// -------------------------------------------------------------- validação

export type FilterErrors = Partial<Record<"from" | "to" | "min" | "max", string>>;

/** Mensagens (pt-BR) por campo; vazio quando o filtro pode ir para a API. */
export function validateFilters(f: ActivityFilters): FilterErrors {
	const errors: FilterErrors = {};
	if (f.period === "custom") {
		const from = f.from.trim() === "" ? null : parseBrDate(f.from);
		const to = f.to.trim() === "" ? null : parseBrDate(f.to);
		if (f.from.trim() !== "" && from === null) errors.from = "Use o formato dd/mm/aaaa.";
		if (f.to.trim() !== "" && to === null) errors.to = "Use o formato dd/mm/aaaa.";
		if (from && to && from > to) errors.to = "A data final precisa ser depois da inicial.";
	}
	const min = parseReais(f.min);
	const max = parseReais(f.max);
	if (min === "invalid") errors.min = "Digite um valor em reais, como 12,50.";
	if (max === "invalid") errors.max = "Digite um valor em reais, como 12,50.";
	if (typeof min === "number" && typeof max === "number" && min > max) {
		errors.max = "O máximo precisa ser maior que o mínimo.";
	}
	return errors;
}

export const hasErrors = (errors: FilterErrors): boolean => Object.keys(errors).length > 0;

// ------------------------------------------------------------ parâmetros

/** Parâmetros da query (`kinds=expense,income`...). Só entram os filtros marcados e válidos. */
export type FilterParams = Record<string, string>;

const csv = (items: readonly string[]): string | undefined =>
	items.length > 0 ? [...new Set(items)].join(",") : undefined;

/**
 * Estado -> parâmetros de `GET /v1/transactions` (e `/count`). Campo inválido é ignorado: quem mostra o erro e
 * bloqueia o "Ver" é `validateFilters`. `today` define "este mês" e "3 meses" (a data do app, sem relógio escondido).
 */
export function toQueryParams(f: ActivityFilters, today: LocalDate): FilterParams {
	const out: FilterParams = {};
	const set = (key: string, value: string | undefined) => {
		if (value !== undefined) out[key] = value;
	};
	if (f.period === "custom") {
		set("from", parseBrDate(f.from) ?? undefined);
		set("to", parseBrDate(f.to) ?? undefined);
	} else if (f.period) {
		const range = periodRange(f.period, today);
		set("from", range.from);
		set("to", range.to);
	}
	const kinds = TYPE_OPTIONS.filter((o) => f.types.includes(o.id)).flatMap((o) => o.kinds);
	set("kinds", csv(kinds));
	set("accountIds", csv(f.accountIds.slice(0, MAX_FILTER_ITEMS)));
	set("cardIds", csv(f.cardIds.slice(0, MAX_FILTER_ITEMS)));
	set("categoryIds", csv(f.categoryIds.slice(0, MAX_FILTER_ITEMS)));
	set("sources", csv(f.sources));
	set("statuses", csv(f.statuses));
	const min = parseReais(f.min);
	const max = parseReais(f.max);
	if (typeof min === "number") set("minCents", String(min));
	if (typeof max === "number") set("maxCents", String(max));
	return out;
}

// ----------------------------------------------------------- contagem/chips

/** Quantos grupos de filtro estão ativos (o número do selo no botão). Contas e cartões contam como um grupo. */
export function activeFilterCount(f: ActivityFilters): number {
	const groups = [
		f.period !== null,
		f.types.length > 0,
		f.accountIds.length + f.cardIds.length > 0,
		f.categoryIds.length > 0,
		f.min.trim() !== "" || f.max.trim() !== "",
		f.sources.length > 0,
		f.statuses.length > 0,
	];
	return groups.filter(Boolean).length;
}

export function hasActiveFilters(f: ActivityFilters): boolean {
	return activeFilterCount(f) > 0;
}

export interface FilterTag {
	key: string;
	label: string;
}

export interface FilterNames {
	accounts: ReadonlyMap<string, { name: string }>;
	cards: ReadonlyMap<string, { name: string }>;
	categories: ReadonlyMap<string, { name: string }>;
}

function valueLabel(f: ActivityFilters): string | null {
	const min = parseReais(f.min);
	const max = parseReais(f.max);
	const lo = typeof min === "number" ? min : null;
	const hi = typeof max === "number" ? max : null;
	if (lo !== null && hi !== null) return `${formatBRL(lo)} a ${formatBRL(hi)}`;
	if (lo !== null) return `A partir de ${formatBRL(lo)}`;
	if (hi !== null) return `Até ${formatBRL(hi)}`;
	return null;
}

function periodLabel(f: ActivityFilters): string | null {
	if (f.period === null) return null;
	if (f.period !== "custom") return PERIOD_OPTIONS.find((o) => o.id === f.period)?.label ?? null;
	const from = parseBrDate(f.from);
	const to = parseBrDate(f.to);
	if (from && to) return `${toBrDate(from)} a ${toBrDate(to)}`;
	if (from) return `Desde ${toBrDate(from)}`;
	if (to) return `Até ${toBrDate(to)}`;
	return "Datas";
}

/** Uma etiqueta removível por item marcado, na ordem da gaveta. `key` é o que `removeTag` entende. */
export function filterTags(f: ActivityFilters, names: FilterNames): FilterTag[] {
	const tags: FilterTag[] = [];
	const period = periodLabel(f);
	if (period) tags.push({ key: "period", label: period });
	for (const o of TYPE_OPTIONS)
		if (f.types.includes(o.id)) tags.push({ key: `type:${o.id}`, label: o.label });
	for (const id of f.accountIds) {
		tags.push({ key: `account:${id}`, label: names.accounts.get(id)?.name ?? "Conta" });
	}
	for (const id of f.cardIds) tags.push({ key: `card:${id}`, label: names.cards.get(id)?.name ?? "Cartão" });
	for (const id of f.categoryIds) {
		tags.push({ key: `category:${id}`, label: names.categories.get(id)?.name ?? "Categoria" });
	}
	const value = valueLabel(f);
	if (value) tags.push({ key: "value", label: value });
	for (const o of SOURCE_OPTIONS) {
		if (f.sources.includes(o.id)) tags.push({ key: `source:${o.id}`, label: o.label });
	}
	for (const o of STATUS_OPTIONS) {
		if (f.statuses.includes(o.id)) tags.push({ key: `status:${o.id}`, label: o.label });
	}
	return tags;
}

/** Tira do estado o que a etiqueta representa. Chave desconhecida não muda nada. */
export function removeTag(f: ActivityFilters, key: string): ActivityFilters {
	const [kind, id = ""] = key.split(":");
	switch (kind) {
		case "period":
			return { ...f, period: null, from: "", to: "" };
		case "type":
			return { ...f, types: f.types.filter((x) => x !== id) };
		case "account":
			return { ...f, accountIds: f.accountIds.filter((x) => x !== id) };
		case "card":
			return { ...f, cardIds: f.cardIds.filter((x) => x !== id) };
		case "category":
			return { ...f, categoryIds: f.categoryIds.filter((x) => x !== id) };
		case "value":
			return { ...f, min: "", max: "" };
		case "source":
			return { ...f, sources: f.sources.filter((x) => x !== id) };
		case "status":
			return { ...f, statuses: f.statuses.filter((x) => x !== id) };
		default:
			return f;
	}
}

/** Liga/desliga um item de lista (multi-seleção), mantendo a ordem em que foi marcado. */
export function toggleItem<T>(list: readonly T[], item: T): T[] {
	return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

/**
 * Tira de uma seleção os ids que não existem mais (conta ou categoria apagada depois de marcada), para o filtro
 * não ficar preso a algo que o dono não vê. Só roda quando a lista de origem já carregou.
 */
export function pruneUnknown(
	f: ActivityFilters,
	known: { accounts: ReadonlySet<string>; cards: ReadonlySet<string>; categories: ReadonlySet<string> },
): ActivityFilters {
	const accountIds = f.accountIds.filter((id) => known.accounts.has(id));
	const cardIds = f.cardIds.filter((id) => known.cards.has(id));
	const categoryIds = f.categoryIds.filter((id) => known.categories.has(id));
	if (
		accountIds.length === f.accountIds.length &&
		cardIds.length === f.cardIds.length &&
		categoryIds.length === f.categoryIds.length
	) {
		return f;
	}
	return { ...f, accountIds, cardIds, categoryIds };
}

/** Texto do botão da gaveta: "Ver 42 lançamentos". `count` nulo = ainda contando. */
export function applyLabel(count: number | null): string {
	if (count === null) return "Ver lançamentos";
	if (count === 0) return "Nenhum lançamento";
	return count === 1 ? "Ver 1 lançamento" : `Ver ${count} lançamentos`;
}
