import { colors, spacing } from "@orbita/tokens";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { useClock } from "../../lib/clock.tsx";
import { greetingFor, monthName, pluralDays } from "../../lib/format.ts";
import { combineLoadables, toLoadable } from "../../lib/loadable.ts";
import { usePrivacy } from "../../lib/privacy.tsx";
import { useSession } from "../../lib/session.tsx";
import { BottomBar, ConfirmDialog, Screen, Text } from "../../ui/index.ts";
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

/** Espaço no fim da rolagem para a barra de baixo flutuante não cobrir o último card (120 no Figma). */
const SCROLL_BOTTOM_INSET = 120;

/** Ainda não há perfil/nome no servidor; o avatar usa "V" de "Você" e a saudação vai sem nome. */
const PROFILE_INITIAL = "V";

export const SIGN_OUT_TITLE = "Desconectar este aparelho?";
export const SIGN_OUT_MESSAGE =
	"O servidor deixa de reconhecer este aparelho. Se ele for o único conectado, um código novo aparece nos logs do servidor para você conectar de novo.";

export function HomeScreen() {
	const { signOut } = useSession();
	const { hidden, toggle } = usePrivacy();
	const queryClient = useQueryClient();
	const [refreshing, setRefreshing] = useState(false);
	const [confirmingSignOut, setConfirmingSignOut] = useState(false);

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
		<Screen footer={<BottomBar />} floatingFooter>
			<ScrollView
				contentContainerStyle={{
					paddingHorizontal: spacing.lg,
					paddingBottom: SCROLL_BOTTOM_INSET,
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
					onAvatarLongPress={() => setConfirmingSignOut(true)}
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
					/>
					<InstallmentsSquare installments={toLoadable(installmentsQ)} month={month} hidden={hidden} />
				</View>
				<CategoriesCard state={summaryWithCategories} hidden={hidden} />
				<RecentCard
					state={toLoadable(recentQ)}
					accounts={accountsQ.data?.accounts ?? []}
					categories={categoriesQ.data?.categories ?? []}
					cards={cardsQ.data?.cards ?? []}
					today={today}
					hidden={hidden}
				/>
			</ScrollView>

			<ConfirmDialog
				visible={confirmingSignOut}
				title={SIGN_OUT_TITLE}
				message={SIGN_OUT_MESSAGE}
				confirmLabel="Desconectar"
				onCancel={() => setConfirmingSignOut(false)}
				onConfirm={() => {
					setConfirmingSignOut(false);
					void signOut();
				}}
			/>
		</Screen>
	);
}
