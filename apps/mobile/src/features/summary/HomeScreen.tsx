import { colors, spacing } from "@orbita/tokens";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useClock } from "../../lib/clock.tsx";
import { greetingFor, monthName, pluralDays } from "../../lib/format.ts";
import { combineLoadables, toLoadable } from "../../lib/loadable.ts";
import { usePrivacy } from "../../lib/privacy.tsx";
import { BottomBar, Screen, Text, TOP_FADE, useBottomBarHeight } from "../../ui/index.ts";
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
import { ReportLink } from "../report/ReportLink.tsx";
import { usePendingTransactions } from "../review/queries.ts";
import { ReviewBanner } from "../review/ReviewScreen.tsx";
import { ServerDownScreen } from "../server/ServerDownScreen.tsx";
import { isUnreachableQuery } from "../server/server-model.ts";
import { useProfile } from "../settings/preferences-queries.ts";
import { avatarInitial, greetWithName } from "../settings/profile-model.ts";
import { CategoriesCard } from "./CategoriesCard.tsx";
import { HeroCard } from "./HeroCard.tsx";
import { HomeHeader } from "./HomeHeader.tsx";
import {
	useAccounts,
	useCards,
	useCategories,
	useInstallments,
	useInvoice,
	useRecentTransactions,
	useSummary,
} from "./queries.ts";
import { RecentCard } from "./RecentCard.tsx";
import { InstallmentsSquare, InvoiceSquare } from "./SquareCards.tsx";
import { currentInvoiceMonth } from "./summary-model.ts";

export function HomeScreen() {
	const { hidden, toggle } = usePrivacy();
	const queryClient = useQueryClient();
	const router = useRouter();
	const [refreshing, setRefreshing] = useState(false);
	const bottomBarHeight = useBottomBarHeight();
	// Sincronização do Meu Pluggy que terminou fora desta tela (a diária, por exemplo): recarrega o que mudou.
	usePluggyHomeWatch();

	// Uma única fonte de "hoje" e "mês": todas as consultas usam os mesmos.
	const { today, month, hour } = useClock();

	const summaryQ = useSummary(month);
	const categoriesQ = useCategories();
	const cardsQ = useCards();
	const accountsQ = useAccounts();
	const installmentsQ = useInstallments();
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

	const cards = toLoadable(cardsQ);
	const firstCard = cards.phase === "ready" ? cards.data.cards.find((c) => c.archivedAt === null) : undefined;
	const invoiceQ = useInvoice(firstCard?.id, firstCard ? currentInvoiceMonth(firstCard, today) : undefined);

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
			fadeTop
			footer={<BottomBar onNew={() => router.push("/novo")} onAsk={() => router.push("/chat")} />}
			floatingFooter
		>
			<ScrollView
				contentContainerStyle={{
					paddingTop: TOP_FADE,
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
				<HomeHeader
					initial={avatarInitial(displayName)}
					hidden={hidden}
					onToggleHidden={toggle}
					onAvatarPress={() => router.push("/configuracoes")}
				/>

				<View style={{ paddingTop: spacing.md, paddingBottom: spacing.sm, gap: spacing.xs }}>
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
						onReconnect={() => void reconnect()}
					/>
				))}
				{emptyHome ? <EmptyHero /> : null}
				{showChecklist ? (
					<Checklist checklist={checklist} onOpen={(href) => router.push(href)} onDismiss={dismiss} />
				) : null}
				{emptyHome ? null : (
					<>
						<HeroCard state={summaryWithCategories} hidden={hidden} />
						{pendingQ.data && pendingQ.data.transactions.length > 0 ? (
							<ReviewBanner
								count={pendingQ.data.transactions.length}
								hasMore={pendingQ.data.hasMore}
								onPress={() => router.push("/revisao")}
							/>
						) : null}
						<View style={{ flexDirection: "row", gap: spacing.md }}>
							<InvoiceSquare
								cards={cards}
								invoice={firstCard ? toLoadable(invoiceQ) : null}
								today={today}
								hidden={hidden}
								onPress={() => router.push("/cartao?aba=faturas")}
							/>
							<InstallmentsSquare
								installments={toLoadable(installmentsQ)}
								month={month}
								hidden={hidden}
								onPress={() => router.push("/cartao?aba=parcelas")}
							/>
						</View>
						<CategoriesCard
							state={summaryWithCategories}
							hidden={hidden}
							onPress={() => router.push("/configuracoes/orcamento")}
						/>
						<ReportLink month={month} onPress={() => router.push("/relatorio")} />
						<RecentCard
							state={toLoadable(recentQ)}
							accounts={accountsQ.data?.accounts ?? []}
							categories={categoriesQ.data?.categories ?? []}
							cards={cardsQ.data?.cards ?? []}
							today={today}
							hidden={hidden}
							onSeeAll={() => router.push("/atividades")}
							onOpen={(id) => router.push({ pathname: "/lancamento/[id]", params: { id } })}
						/>
					</>
				)}
			</ScrollView>
		</Screen>
	);
}
