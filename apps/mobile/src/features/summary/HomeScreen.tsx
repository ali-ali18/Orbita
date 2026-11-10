import {
	defaultHomeLayout,
	type HomeLayout,
	moveWidget,
	setWidgetSize,
	setWidgetVisible,
} from "@orbita/shared";
import { colors, layout as sizes, spacing } from "@orbita/tokens";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useClock } from "../../lib/clock.tsx";
import { greetingFor, monthName, pluralDays } from "../../lib/format.ts";
import { combineLoadables, toLoadable } from "../../lib/loadable.ts";
import { usePrivacy } from "../../lib/privacy.tsx";
import {
	BottomBar,
	Button,
	FadeEdge,
	Screen,
	Skeleton,
	Text,
	TOP_FADE,
	useBottomBarHeight,
} from "../../ui/index.ts";
import { disconnectedConnections } from "../banks/banks-model.ts";
import { usePluggyHomeWatch, usePluggyStatusSnapshot } from "../banks/queries.ts";
import { ReconnectBanner } from "../banks/ReconnectBanner.tsx";
import { useConnectLauncher } from "../banks/use-connect.ts";
import { useNow } from "../banks/use-now.ts";
import { Checklist } from "../checklist/Checklist.tsx";
import { EMPTY_HOME_CAPTION, isFirstUse, shouldShowChecklist } from "../checklist/checklist-model.ts";
import { EmptyHero } from "../checklist/EmptyHero.tsx";
import { useChecklistDismissed, useChecklistFacts } from "../checklist/use-checklist.ts";
import { paydayLine } from "../income/income-model.ts";
import { useIncome } from "../income/queries.ts";
import { InvestmentsTab } from "../investments/InvestmentsTab.tsx";
import { usePendingTransactions } from "../review/queries.ts";
import { ReviewBanner } from "../review/ReviewScreen.tsx";
import { ServerDownScreen } from "../server/ServerDownScreen.tsx";
import { isUnreachableQuery } from "../server/server-model.ts";
import { useProfile } from "../settings/preferences-queries.ts";
import { avatarInitial, greetWithName } from "../settings/profile-model.ts";
import { HomeHeader } from "./HomeHeader.tsx";
import { HomePager, HomeTabsBar, useHomePager } from "./HomePager.tsx";
import { useHomeLayout, useSaveHomeLayout } from "./layout-queries.ts";
import {
	useAccountBalances,
	useAccounts,
	useCards,
	useCashFlow,
	useCategories,
	useInstallments,
	useInvoicesOverview,
	useRecentTransactions,
	useSummary,
} from "./queries.ts";
import { AddWidgetsSheet } from "./widgets/AddWidgetsSheet.tsx";
import { HomeWidgets } from "./widgets/HomeWidgets.tsx";
import { useWidgetMenu } from "./widgets/use-widget-menu.ts";
import { WidgetMenu } from "./widgets/WidgetMenu.tsx";
import { addableWidgets } from "./widgets/widget-menu-model.ts";

export function HomeScreen() {
	const { hidden, toggle } = usePrivacy();
	const queryClient = useQueryClient();
	const router = useRouter();
	const [refreshing, setRefreshing] = useState(false);
	const bottomBarHeight = useBottomBarHeight();
	const pager = useHomePager();
	// A base do header fixo: o conteúdo começa abaixo dele (e do degradê) e o menu do widget usa como topo útil.
	const headerBottom = sizes.homeHeader + sizes.homeTabs;
	const contentTop = headerBottom + TOP_FADE;
	// Widgets: o layout vem do servidor; segurar um widget abre o menu colado nele e cada escolha vale na hora.
	const layoutQ = useHomeLayout();
	const saveLayout = useSaveHomeLayout();
	const layout: HomeLayout | null = layoutQ.data ?? (layoutQ.isError ? defaultHomeLayout() : null);
	const widgetMenu = useWidgetMenu(layout, bottomBarHeight, headerBottom);
	const menuId = widgetMenu.menu?.model.id ?? null;
	const [adding, setAdding] = useState(false);
	const addable = layout ? addableWidgets(layout) : [];
	/** Salva na hora: a tela já mostra o novo e volta atrás se o servidor recusar. */
	const change = (next: (current: HomeLayout) => HomeLayout) => {
		if (layout) saveLayout.mutate(next(layout));
	};
	// Sincronização do Meu Pluggy que terminou fora desta tela (a diária, por exemplo): recarrega o que mudou.
	usePluggyHomeWatch();

	// Uma única fonte de "hoje" e "mês": todas as consultas usam os mesmos.
	const { today, month, hour } = useClock();

	const summaryQ = useSummary(month);
	const categoriesQ = useCategories();
	const cardsQ = useCards();
	const accountsQ = useAccounts();
	const installmentsQ = useInstallments();
	const balancesQ = useAccountBalances();
	const cashFlowQ = useCashFlow(month);
	const overviewQ = useInvoicesOverview();
	const recentQ = useRecentTransactions(4);
	const pendingQ = usePendingTransactions();
	// "Salário cai em N dias": o próximo pagamento é calculado pelo servidor; sem renda cadastrada, a linha não aparece.
	const income = useIncome().data;
	const nextPay = income?.nextPayday ?? null;
	const paydayText = nextPay
		? paydayLine(income?.sources.find((s) => s.id === nextPay.sourceId)?.name ?? "Renda", nextPay.daysUntil)
		: null;
	// Sem nome (ou enquanto carrega) a saudação vai como sempre e o avatar usa "V".
	const displayName = useProfile().data?.displayName ?? null;
	const pluggyQ = usePluggyStatusSnapshot();
	const now = useNow();
	const disconnected = disconnectedConnections(pluggyQ.data?.connections ?? []);
	const { start: reconnect, pending: reconnecting } = useConnectLauncher(
		(pluggyQ.data?.connections ?? []).map((c) => c.id),
	);

	// Primeiros passos: derivados de dado real; somem completos ou dispensados.
	const { dismissed, dismiss } = useChecklistDismissed();
	const facts = useChecklistFacts(recentQ.data?.transactions.length);
	const { show: showChecklist, checklist } = shouldShowChecklist(facts, dismissed);
	const emptyHome = showChecklist && isFirstUse(facts.transactionCount);

	const summary = toLoadable(summaryQ);
	const summaryWithCategories = combineLoadables(summary, toLoadable(categoriesQ));

	const onRefresh = async () => {
		setRefreshing(true);
		try {
			await queryClient.invalidateQueries();
		} finally {
			setRefreshing(false);
		}
	};

	// Sem dado nenhum e sem conseguir falar com o servidor: o estado "fora do ar" no lugar do erro genérico.
	if (isUnreachableQuery(summaryQ)) {
		return <ServerDownScreen onRetry={() => queryClient.refetchQueries({ type: "active" })} />;
	}

	return (
		<Screen
			footer={<BottomBar onNew={() => router.push("/novo")} onAsk={() => router.push("/chat")} />}
			floatingFooter
		>
			<HomePager pager={pager}>
				<ScrollView
					ref={widgetMenu.scrollRef}
					onScroll={widgetMenu.onScroll}
					scrollEventThrottle={16}
					contentContainerStyle={{
						paddingTop: contentTop,
						paddingHorizontal: spacing.lg,
						paddingBottom: bottomBarHeight + spacing.lg,
						gap: spacing.md,
					}}
					refreshControl={
						<RefreshControl
							refreshing={refreshing}
							onRefresh={onRefresh}
							tintColor={colors.text}
							colors={[colors.text]}
							progressBackgroundColor={colors.surface2}
						/>
					}
				>
					<View style={{ paddingBottom: spacing.sm, gap: spacing.xs }}>
						<Text variant="greeting" accessibilityRole="header">
							{greetWithName(greetingFor(hour), displayName)}
						</Text>
						<Text variant="caption" tone="secondary">
							{emptyHome ? EMPTY_HOME_CAPTION : monthName(month)}
							{!emptyHome && summary.phase === "ready" && summary.data.safeToSpend
								? ` · faltam ${pluralDays(summary.data.safeToSpend.remainingDays)}`
								: ""}
						</Text>
						{!emptyHome && paydayText ? (
							<Pressable
								accessibilityRole="button"
								accessibilityLabel={`${paydayText}. Abrir renda`}
								hitSlop={8}
								onPress={() => router.push("/configuracoes/renda")}
								style={({ pressed }) => ({
									minHeight: 44,
									justifyContent: "center",
									opacity: pressed ? 0.8 : 1,
								})}
							>
								<Text variant="caption" tone="secondary">
									{paydayText}
								</Text>
							</Pressable>
						) : null}
					</View>

					{disconnected.map((c) => (
						<ReconnectBanner
							key={c.id}
							connection={c}
							now={now}
							loading={reconnecting}
							onReconnect={() => void reconnect(c.id)}
						/>
					))}
					{emptyHome ? <EmptyHero /> : null}
					{showChecklist ? (
						<Checklist checklist={checklist} onOpen={(href) => router.push(href)} onDismiss={dismiss} />
					) : null}
					{emptyHome ? null : (
						<>
							{pendingQ.data && pendingQ.data.transactions.length > 0 ? (
								<ReviewBanner
									count={pendingQ.data.transactions.length}
									hasMore={pendingQ.data.hasMore}
									onPress={() => router.push("/revisao")}
								/>
							) : null}
							{layout ? (
								<HomeWidgets
									layout={layout}
									onLongPress={widgetMenu.open}
									register={widgetMenu.register}
									data={{
										month,
										today,
										hidden,
										summary: summaryWithCategories,
										overview: toLoadable(overviewQ),
										balances: toLoadable(balancesQ),
										cashFlow: toLoadable(cashFlowQ),
										installments: toLoadable(installmentsQ),
										recent: toLoadable(recentQ),
										accounts: accountsQ.data?.accounts ?? [],
										cards: cardsQ.data?.cards ?? [],
										categories: categoriesQ.data?.categories ?? [],
										open: (href) => router.push(href as never),
										openTransaction: (id) => router.push({ pathname: "/lancamento/[id]", params: { id } }),
									}}
								/>
							) : (
								<View accessibilityLabel="Carregando" style={{ gap: spacing.md }}>
									<Skeleton height={160} />
									<Skeleton height={120} />
								</View>
							)}
							{addable.length > 0 ? (
								<View style={{ alignItems: "center", paddingTop: spacing.sm }}>
									<Button
										label="Adicionar widgets"
										variant="secondary"
										compact
										icon="mais"
										onPress={() => setAdding(true)}
									/>
								</View>
							) : null}
						</>
					)}
				</ScrollView>
				<InvestmentsTab topPadding={contentTop} bottomPadding={bottomBarHeight + spacing.lg} />
			</HomePager>
			{/* Um bloco só: avatar, olho e abas. Fica sobre as páginas (o conteúdo rola por baixo) e o degradê na base
			    faz o que passa por baixo sumir suave, sem corte seco. */}
			<View pointerEvents="box-none" style={{ position: "absolute", top: 0, left: 0, right: 0 }}>
				<View style={{ backgroundColor: colors.background }}>
					<View style={{ paddingHorizontal: spacing.lg }}>
						<HomeHeader
							height={sizes.homeHeader}
							initial={avatarInitial(displayName)}
							hidden={hidden}
							onToggleHidden={toggle}
							onAvatarPress={() => router.push("/configuracoes")}
						/>
					</View>
					<HomeTabsBar pager={pager} />
				</View>
				<FadeEdge style={{ height: TOP_FADE }} />
			</View>
			<WidgetMenu
				menu={widgetMenu.menu}
				viewport={widgetMenu.viewport}
				menuHeight={widgetMenu.menuHeight}
				onMenuHeight={widgetMenu.setMenuHeight}
				valuesHidden={hidden}
				onToggleValues={toggle}
				onSize={(size) => menuId && change((l) => setWidgetSize(l, menuId, size))}
				onMove={(direction) => menuId && change((l) => moveWidget(l, menuId, direction))}
				onRemove={() => {
					if (menuId) change((l) => setWidgetVisible(l, menuId, false));
					widgetMenu.close();
				}}
				onAdd={() => {
					widgetMenu.close();
					setAdding(true);
				}}
				onClose={widgetMenu.close}
			/>
			<AddWidgetsSheet
				visible={adding && addable.length > 0}
				widgets={addable}
				onAdd={(id) => change((l) => setWidgetVisible(l, id, true))}
				onClose={() => setAdding(false)}
			/>
		</Screen>
	);
}
