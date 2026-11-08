import { colors, spacing } from "@orbita/tokens";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { useClock } from "../../lib/clock.tsx";
import { greetingFor, monthName, pluralDays } from "../../lib/format.ts";
import { combineLoadables, toLoadable } from "../../lib/loadable.ts";
import { usePrivacy } from "../../lib/privacy.tsx";
import { BottomBar, Screen, Text, useBottomBarHeight } from "../../ui/index.ts";
import { usePluggyHomeWatch } from "../banks/queries.ts";
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

/** Ainda não há perfil/nome no servidor; o avatar usa "V" de "Você" e a saudação vai sem nome. */
const PROFILE_INITIAL = "V";

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

	return (
		<Screen
			fadeTop
			footer={<BottomBar onNew={() => router.push("/novo")} onAsk={() => router.push("/chat")} />}
			floatingFooter
		>
			<ScrollView
				contentContainerStyle={{
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
					initial={PROFILE_INITIAL}
					hidden={hidden}
					onToggleHidden={toggle}
					onAvatarPress={() => router.push("/configuracoes")}
				/>

				<View style={{ paddingTop: spacing.md, paddingBottom: spacing.sm, gap: spacing.xs }}>
					<Text variant="greeting" accessibilityRole="header">
						{greetingFor(hour)}
					</Text>
					<Text variant="caption" tone="secondary">
						{monthName(month)}
						{summary.phase === "ready" && summary.data.safeToSpend
							? ` · faltam ${pluralDays(summary.data.safeToSpend.remainingDays)}`
							: ""}
					</Text>
				</View>

				<HeroCard state={summaryWithCategories} hidden={hidden} />
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
			</ScrollView>
		</Screen>
	);
}
