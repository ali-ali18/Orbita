import type { HomeWidgetId } from "@orbita/shared";

/** Para onde o toque curto de cada widget leva (a tela de detalhe). Segurar abre o menu, em qualquer widget. */
export const WIDGET_ROUTES: Readonly<Record<HomeWidgetId, string>> = {
	hero: "/gasto-do-mes",
	wallet: "/cartao?aba=faturas",
	balance: "/saldo",
	limit: "/cartao?aba=limites",
	cashflow: "/fluxo",
	installments: "/cartao?aba=parcelas",
	categories: "/configuracoes/orcamento",
	subscriptions: "/assinaturas",
	report: "/relatorio",
	recent: "/atividades",
};
