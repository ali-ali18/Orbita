import { type HomeLayout, type HomeLayoutItem, homeRows } from "@orbita/shared";
import { spacing } from "@orbita/tokens";
import type { ReactNode } from "react";
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
				<WalletWide state={data.overview} hidden={hidden} onPress={() => open("/cartao?aba=faturas")} />
			) : (
				<WalletBlock
					overview={data.overview}
					today={today}
					hidden={hidden}
					onOpen={() => open("/cartao?aba=faturas")}
				/>
			);
		case "balance": {
			const onPress = () => open("/saldo");
			if (size === "2x4") return <BalanceWide state={data.balances} hidden={hidden} onPress={onPress} />;
			if (size === "4x4") return <BalanceTall state={data.balances} hidden={hidden} onPress={onPress} />;
			return <BalanceTile state={data.balances} hidden={hidden} onPress={onPress} />;
		}
		case "limit": {
			const onPress = () => open("/cartao?aba=limites");
			if (size === "2x4") return <LimitWide state={data.overview} hidden={hidden} onPress={onPress} />;
			if (size === "4x4") return <LimitTall state={data.overview} hidden={hidden} onPress={onPress} />;
			return <LimitTile state={data.overview} hidden={hidden} onPress={onPress} />;
		}
		case "cashflow":
			return size === "2x4" ? (
				<CashFlowWide state={data.cashFlow} hidden={hidden} onPress={() => open("/fluxo")} />
			) : (
				<CashFlowTile state={data.cashFlow} hidden={hidden} onPress={() => open("/fluxo")} />
			);
		case "installments":
			return size === "2x4" ? (
				<InstallmentsWide
					state={data.installments}
					month={month}
					hidden={hidden}
					onPress={() => open("/cartao?aba=parcelas")}
				/>
			) : (
				<InstallmentsSquare
					installments={data.installments}
					month={month}
					hidden={hidden}
					onPress={() => open("/cartao?aba=parcelas")}
				/>
			);
		case "categories":
			return size === "2x2" ? (
				<CategoriesSquare
					state={data.summary}
					hidden={hidden}
					onPress={() => open("/configuracoes/orcamento")}
				/>
			) : (
				<CategoriesCard
					state={data.summary}
					hidden={hidden}
					onPress={() => open("/configuracoes/orcamento")}
				/>
			);
		case "subscriptions":
			return (
				<SubscriptionsWidget size={size} today={today} hidden={hidden} onPress={() => open("/assinaturas")} />
			);
		case "report":
			return <ReportLink month={month} onPress={() => open("/relatorio")} />;
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
					onSeeAll={() => open("/atividades")}
					onOpen={data.openTransaction}
				/>
			);
	}
}

/** Segurar o widget entrega o gesto a quem estiver dentro dele (card, linha, faixa). */
function Held({ onLongPress, children }: { onLongPress: () => void; children: ReactNode }) {
	return <LongPressContext.Provider value={onLongPress}>{children}</LongPressContext.Provider>;
}

/**
 * A grade do Início: os visíveis na ordem do layout. Dois 2x2 seguidos ficam lado a lado; um 2x2 sozinho fica na
 * própria linha em meia largura; 2x4 e 4x4 ocupam a largura toda.
 */
export function HomeWidgets({
	layout,
	data,
	onLongPress,
}: {
	layout: HomeLayout;
	data: HomeWidgetData;
	onLongPress: (id: HomeLayoutItem["id"]) => void;
}) {
	return (
		<>
			{homeRows(layout).map((row) =>
				row.kind === "full" ? (
					<Held key={row.item.id} onLongPress={() => onLongPress(row.item.id)}>
						<WidgetBody item={row.item} data={data} />
					</Held>
				) : (
					<View key={row.items.map((i) => i.id).join("+")} style={{ flexDirection: "row", gap: spacing.md }}>
						{row.items.map((item) => (
							<Held key={item.id} onLongPress={() => onLongPress(item.id)}>
								<WidgetBody item={item} data={data} />
							</Held>
						))}
						{row.items.length === 1 ? <View style={{ flex: 1 }} /> : null}
					</View>
				),
			)}
		</>
	);
}
