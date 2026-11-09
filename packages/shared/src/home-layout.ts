import { z } from "zod";

/*
 * Widgets do Início: o catálogo (ids estáveis, tamanhos que cada um aceita) e as regras puras do layout do dono
 * (ordem, visibilidade e tamanho). O app e a API usam as mesmas funções, então a tela e o servidor nunca discordam.
 *
 * Tamanhos: "2x2" é um quadrado de meia largura (dois se emparelham), "2x4" é largura cheia e baixo, "4x4" é
 * largura cheia e alto (o expandido).
 */

export const HOME_WIDGET_SIZES = ["2x2", "2x4", "4x4"] as const;
export type HomeWidgetSize = (typeof HOME_WIDGET_SIZES)[number];

export const HOME_WIDGET_IDS = [
	"hero",
	"wallet",
	"balance",
	"limit",
	"cashflow",
	"installments",
	"categories",
	"subscriptions",
	"report",
	"recent",
] as const;
export type HomeWidgetId = (typeof HOME_WIDGET_IDS)[number];

export interface HomeWidgetDef {
	/** Nome curto para a lista de edição ("Dá pra gastar"). */
	label: string;
	/** Tamanhos que têm versão própria, do menor para o maior. */
	sizes: readonly HomeWidgetSize[];
	/** Tamanho em que o widget entra (no layout padrão e quando é adicionado). */
	defaultSize: HomeWidgetSize;
}

export const HOME_WIDGETS: Readonly<Record<HomeWidgetId, HomeWidgetDef>> = {
	hero: { label: "Dá pra gastar", sizes: ["2x4", "4x4"], defaultSize: "4x4" },
	wallet: { label: "Faturas", sizes: ["2x4", "4x4"], defaultSize: "4x4" },
	balance: { label: "Saldo em contas", sizes: ["2x2", "2x4", "4x4"], defaultSize: "2x2" },
	limit: { label: "Limite", sizes: ["2x2", "2x4", "4x4"], defaultSize: "2x2" },
	cashflow: { label: "Fluxo de caixa", sizes: ["2x2", "2x4"], defaultSize: "2x2" },
	installments: { label: "Parcelamentos", sizes: ["2x2", "2x4"], defaultSize: "2x2" },
	categories: { label: "Gastos por categoria", sizes: ["2x2", "4x4"], defaultSize: "4x4" },
	subscriptions: { label: "Assinaturas", sizes: ["2x2", "2x4", "4x4"], defaultSize: "2x2" },
	report: { label: "Relatório do mês", sizes: ["2x4"], defaultSize: "2x4" },
	recent: { label: "Últimos lançamentos", sizes: ["2x4", "4x4"], defaultSize: "4x4" },
};

export interface HomeLayoutItem {
	id: HomeWidgetId;
	size: HomeWidgetSize;
	visible: boolean;
}
export type HomeLayout = HomeLayoutItem[];

export const isHomeWidgetId = (value: unknown): value is HomeWidgetId =>
	typeof value === "string" && (HOME_WIDGET_IDS as readonly string[]).includes(value);

export const supportsSize = (id: HomeWidgetId, size: unknown): size is HomeWidgetSize =>
	(HOME_WIDGETS[id].sizes as readonly unknown[]).includes(size);

const VISIBLE_BY_DEFAULT: ReadonlySet<HomeWidgetId> = new Set([
	"hero",
	"wallet",
	"balance",
	"limit",
	"categories",
	"recent",
]);

/** Layout enxuto: dá pra gastar e faturas de largura cheia, saldo e limite lado a lado, categorias e recentes. */
export const DEFAULT_HOME_LAYOUT: Readonly<HomeLayout> = [
	...HOME_WIDGET_IDS.filter((id) => VISIBLE_BY_DEFAULT.has(id)).map((id) => ({
		id,
		size: HOME_WIDGETS[id].defaultSize,
		visible: true,
	})),
	...HOME_WIDGET_IDS.filter((id) => !VISIBLE_BY_DEFAULT.has(id)).map((id) => ({
		id,
		size: HOME_WIDGETS[id].defaultSize,
		visible: false,
	})),
];

/** O layout padrão pronto para mexer (cópia profunda). */
export const defaultHomeLayout = (): HomeLayout => DEFAULT_HOME_LAYOUT.map((i) => ({ ...i }));

/** O que o app manda por widget: nada de campo extra, id fora do catálogo ou tamanho desconhecido. */
export const homeLayoutItemSchema = z
	.object({
		id: z.enum(HOME_WIDGET_IDS, { error: "Widget desconhecido." }),
		size: z.enum(HOME_WIDGET_SIZES, { error: "Tamanho desconhecido." }),
		visible: z.boolean({ error: "Informe se o widget aparece." }),
	})
	.strict();

/** Erro em pt-BR do layout, ou `null` se vale: ids únicos e conhecidos, tamanhos que o widget aceita. */
export function homeLayoutProblem(items: readonly HomeLayoutItem[]): string | null {
	const seen = new Set<string>();
	for (const item of items) {
		if (seen.has(item.id)) return "Widget repetido.";
		seen.add(item.id);
		if (!supportsSize(item.id, item.size)) {
			return `${HOME_WIDGETS[item.id].label} não tem o tamanho ${item.size}.`;
		}
	}
	return null;
}

export const homeLayoutBody = z
	.object({ items: z.array(homeLayoutItemSchema).max(HOME_WIDGET_IDS.length, "Widgets demais.") })
	.strict()
	.superRefine((value, ctx) => {
		const problem = homeLayoutProblem(value.items);
		if (problem) ctx.addIssue({ code: "custom", message: problem, path: ["items"] });
	});
export type HomeLayoutBody = z.infer<typeof homeLayoutBody>;

/** `GET`/`PUT /v1/home/layout`. */
export const homeLayoutResponse = z.object({ items: z.array(homeLayoutItemSchema) });
export type HomeLayoutResponse = z.infer<typeof homeLayoutResponse>;

/**
 * Põe o layout guardado em dia com o catálogo de hoje (o catálogo cresce com o app): ids que não existem mais saem,
 * repetidos ficam com o primeiro, tamanho que o widget deixou de aceitar volta ao padrão dele e widget novo entra
 * oculto no fim. Os visíveis ficam sempre antes dos ocultos, na ordem em que estavam.
 */
export function reconcileHomeLayout(stored: readonly unknown[] | null | undefined): HomeLayout {
	if (!stored) return defaultHomeLayout();
	const items: HomeLayout = [];
	const seen = new Set<HomeWidgetId>();
	for (const raw of stored) {
		if (typeof raw !== "object" || raw === null) continue;
		const { id, size, visible } = raw as Record<string, unknown>;
		if (!isHomeWidgetId(id) || seen.has(id)) continue;
		seen.add(id);
		items.push({
			id,
			size: supportsSize(id, size) ? size : HOME_WIDGETS[id].defaultSize,
			visible: visible === true,
		});
	}
	for (const id of HOME_WIDGET_IDS) {
		if (!seen.has(id)) items.push({ id, size: HOME_WIDGETS[id].defaultSize, visible: false });
	}
	return [...items.filter((i) => i.visible), ...items.filter((i) => !i.visible)];
}

/** Muda o tamanho; tamanho que o widget não aceita é ignorado. */
export function setWidgetSize(layout: HomeLayout, id: HomeWidgetId, size: HomeWidgetSize): HomeLayout {
	if (!supportsSize(id, size)) return layout;
	return layout.map((i) => (i.id === id ? { ...i, size } : i));
}

/** Oculta (vai para o fim, entre os ocultos) ou mostra (entra logo depois do último visível). */
export function setWidgetVisible(layout: HomeLayout, id: HomeWidgetId, visible: boolean): HomeLayout {
	const target = layout.find((i) => i.id === id);
	if (!target || target.visible === visible) return layout;
	const rest = layout.filter((i) => i.id !== id);
	const next = { ...target, visible };
	if (!visible) return [...rest, next];
	const lastVisible = rest.reduce((at, i, index) => (i.visible ? index : at), -1);
	return [...rest.slice(0, lastVisible + 1), next, ...rest.slice(lastVisible + 1)];
}

/** Sobe (-1) ou desce (+1) um widget visível entre os visíveis; nas pontas, nada muda. */
export function moveWidget(layout: HomeLayout, id: HomeWidgetId, direction: -1 | 1): HomeLayout {
	const visible = layout.filter((i) => i.visible);
	const from = visible.findIndex((i) => i.id === id);
	const to = from + direction;
	if (from < 0 || to < 0 || to >= visible.length) return layout;
	const moved = [...visible];
	const [item] = moved.splice(from, 1);
	if (!item) return layout;
	moved.splice(to, 0, item);
	return [...moved, ...layout.filter((i) => !i.visible)];
}

/** Uma linha do Início: um widget de largura cheia, ou um ou dois quadrados 2x2. */
export type HomeRow =
	| { kind: "full"; item: HomeLayoutItem }
	| { kind: "pair"; items: [HomeLayoutItem] | [HomeLayoutItem, HomeLayoutItem] };

/**
 * A grade: só os visíveis, na ordem. Dois 2x2 seguidos se emparelham lado a lado; um 2x2 sozinho (o próximo é
 * largo ou acabou a lista) fica na própria linha, em meia largura. Os outros ocupam a largura toda.
 */
export function homeRows(layout: readonly HomeLayoutItem[]): HomeRow[] {
	const rows: HomeRow[] = [];
	const visible = layout.filter((i) => i.visible);
	for (let i = 0; i < visible.length; i++) {
		const item = visible[i] as HomeLayoutItem;
		if (item.size !== "2x2") {
			rows.push({ kind: "full", item });
			continue;
		}
		const next = visible[i + 1];
		if (next && next.size === "2x2") {
			rows.push({ kind: "pair", items: [item, next] });
			i++;
		} else {
			rows.push({ kind: "pair", items: [item] });
		}
	}
	return rows;
}
