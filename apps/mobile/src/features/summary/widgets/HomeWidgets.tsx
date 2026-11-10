import { type HomeLayout, type HomeLayoutItem, type HomeWidgetId, homeRows } from "@orbita/shared";
import { spacing } from "@orbita/tokens";
import { View } from "react-native";
import type {
	AccountBalancesView,
	AccountsView,
	CardsView,
	CashFlowView,
	CategoriesView,
	InstallmentsView,
	InvoicesOverviewView,
	MonthSummary,
	RecentTransactions,
} from "../../../lib/api.ts";
import type { Loadable } from "../../../lib/loadable.ts";
import { LongPressContext } from "../../../ui/index.ts";
import { ReportLink } from "../../report/ReportLink.tsx";
import { BalanceTile, CashFlowTile, LimitTile } from "../BankCards.tsx";
import { CategoriesCard } from "../CategoriesCard.tsx";
import { HeroCard } from "../HeroCard.tsx";
import { RecentCard } from "../RecentCard.tsx";
import { InstallmentsSquare } from "../SquareCards.tsx";
import { WalletBlock } from "../WalletBlock.tsx";
import { SubscriptionsWidget } from "./SubscriptionsWidget.tsx";
import type { WidgetNode } from "./use-widget-menu.ts";
import {
	BalanceTall,
	BalanceWide,
	CashFlowWide,
	CategoriesSquare,
	InstallmentsWide,
	LimitTall,
	LimitWide,
	WalletWide,
} from "./variants.tsx";
import { WIDGET_ROUTES } from "./widget-routes.ts";

/** Tudo que os widgets exibem, já carregado pela tela (cada widget só desenha o que a API devolveu). */
export interface HomeWidgetData {
	month: string;
	today: string;
	hidden: boolean;
	summary: Loadable<[MonthSummary, CategoriesView]>;
	overview: Loadable<InvoicesOverviewView>;
	balances: Loadable<AccountBalancesView>;
	cashFlow: Loadable<CashFlowView>;
	installments: Loadable<InstallmentsView>;
	recent: Loadable<RecentTransactions>;
	accounts: AccountsView["accounts"];
	cards: CardsView["cards"];
	categories: CategoriesView["categories"];
	open: (href: string) => void;
	openTransaction: (id: string) => void;
}

/** O widget no tamanho que o dono escolheu. */
export function WidgetBody({ item, data }: { item: HomeLayoutItem; data: HomeWidgetData }) {
	const { hidden, month, today, open } = data;
	const { size } = item;
	switch (item.id) {
		case "hero":
			return <HeroCard state={data.summary} hidden={hidden} compact={size === "2x4"} />;
		case "wallet":
			return size === "2x4" ? (
				<WalletWide state={data.overview} hidden={hidden} onPress={() => open(WIDGET_ROUTES.wallet)} />
			) : (
				<WalletBlock
					overview={data.overview}
					today={today}
					hidden={hidden}
					onOpen={() => open(WIDGET_ROUTES.wallet)}
				/>
			);
		case "balance": {
			const onPress = () => open(WIDGET_ROUTES.balance);
			if (size === "2x4") return <BalanceWide state={data.balances} hidden={hidden} onPress={onPress} />;
			if (size === "4x4") return <BalanceTall state={data.balances} hidden={hidden} onPress={onPress} />;
			return <BalanceTile state={data.balances} hidden={hidden} onPress={onPress} />;
		}
		case "limit": {
			const onPress = () => open(WIDGET_ROUTES.limit);
			if (size === "2x4") return <LimitWide state={data.overview} hidden={hidden} onPress={onPress} />;
			if (size === "4x4") return <LimitTall state={data.overview} hidden={hidden} onPress={onPress} />;
			return <LimitTile state={data.overview} hidden={hidden} onPress={onPress} />;
		}
		case "cashflow":
			return size === "2x4" ? (
				<CashFlowWide state={data.cashFlow} hidden={hidden} onPress={() => open(WIDGET_ROUTES.cashflow)} />
			) : (
				<CashFlowTile state={data.cashFlow} hidden={hidden} onPress={() => open(WIDGET_ROUTES.cashflow)} />
			);
		case "installments":
			return size === "2x4" ? (
				<InstallmentsWide
					state={data.installments}
					month={month}
					hidden={hidden}
					onPress={() => open(WIDGET_ROUTES.installments)}
				/>
			) : (
				<InstallmentsSquare
					installments={data.installments}
					month={month}
					hidden={hidden}
					onPress={() => open(WIDGET_ROUTES.installments)}
				/>
			);
		case "categories":
			return size === "2x2" ? (
				<CategoriesSquare
					state={data.summary}
					hidden={hidden}
					onPress={() => open(WIDGET_ROUTES.categories)}
				/>
			) : (
				<CategoriesCard state={data.summary} hidden={hidden} onPress={() => open(WIDGET_ROUTES.categories)} />
			);
		case "subscriptions":
			return (
				<SubscriptionsWidget
					size={size}
					today={today}
					hidden={hidden}
					onPress={() => open(WIDGET_ROUTES.subscriptions)}
				/>
			);
		case "report":
			return <ReportLink month={month} onPress={() => open(WIDGET_ROUTES.report)} />;
		case "recent":
			return (
				<RecentCard
					state={data.recent}
					accounts={data.accounts}
					cards={data.cards}
					categories={data.categories}
					today={today}
					hidden={hidden}
					{...(size === "2x4" ? { max: 2 } : {})}
					onSeeAll={() => open(WIDGET_ROUTES.recent)}
					onOpen={data.openTransaction}
				/>
			);
	}
}

/**
 * Um widget da grade: entrega o segurar a quem estiver dentro dele (card, linha, faixa) e se registra para o menu
 * medir onde ele está na tela. `half` é o 2x2: divide a linha e deixa o card esticar na altura do vizinho.
 */
function Slot({
	item,
	data,
	half = false,
	onLongPress,
	register,
}: {
	item: HomeLayoutItem;
	data: HomeWidgetData;
	half?: boolean;
	onLongPress: (id: HomeWidgetId) => void;
	register: (id: HomeWidgetId, node: WidgetNode | null) => void;
}) {
	return (
		<View
			ref={(node) => register(item.id, node)}
			collapsable={false}
			style={half ? { flex: 1, flexDirection: "row" } : undefined}
		>
			<LongPressContext.Provider value={() => onLongPress(item.id)}>
				<WidgetBody item={item} data={data} />
			</LongPressContext.Provider>
		</View>
	);
}

/**
 * A grade do Início: os visíveis na ordem do layout. Dois 2x2 seguidos ficam lado a lado; um 2x2 sozinho fica na
 * própria linha em meia largura; 2x4 e 4x4 ocupam a largura toda.
 */
export function HomeWidgets({
	layout,
	data,
	onLongPress,
	register,
}: {
	layout: HomeLayout;
	data: HomeWidgetData;
	onLongPress: (id: HomeWidgetId) => void;
	/** Guarda a `View` de cada widget, para o menu ancorar nele. */
	register: (id: HomeWidgetId, node: WidgetNode | null) => void;
}) {
	return (
		<>
			{homeRows(layout).map((row) =>
				row.kind === "full" ? (
					<Slot key={row.item.id} item={row.item} data={data} onLongPress={onLongPress} register={register} />
				) : (
					<View key={row.items.map((i) => i.id).join("+")} style={{ flexDirection: "row", gap: spacing.md }}>
						{row.items.map((item) => (
							<Slot
								key={item.id}
								item={item}
								data={data}
								half
								onLongPress={onLongPress}
								register={register}
							/>
						))}
						{row.items.length === 1 ? <View style={{ flex: 1 }} /> : null}
					</View>
				),
			)}
		</>
	);
}
