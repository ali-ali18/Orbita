import { monthOf } from "@orbita/core";
import { spacing } from "@orbita/tokens";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { ApiError } from "../../lib/api.ts";
import { greetingFor, monthName, pluralDays } from "../../lib/format.ts";
import { usePrivacy } from "../../lib/privacy.tsx";
import { useSession } from "../../lib/session.tsx";
import { hourLocal, todayLocal } from "../../lib/today.ts";
import { BottomBar, Button, Card, Screen, Text } from "../../ui/index.ts";
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
	const { signOut } = useSession();
	const { hidden, toggle } = usePrivacy();
	const queryClient = useQueryClient();
	const [refreshing, setRefreshing] = useState(false);

	const today = useMemo(() => todayLocal(), []);
	const month = monthOf(today);

	const summary = useSummary(month);
	const categories = useCategories();
	const cards = useCards();
	const accounts = useAccounts();
	const installments = useInstallments();
	const recent = useRecentTransactions(5);

	const firstCard = cards.data?.cards.find((c) => c.archivedAt === null);
	const invoice = useInvoice(firstCard?.id, firstCard ? currentInvoiceMonth(firstCard, today) : undefined);

	// Sessão expirada ou aparelho removido: volta para o pareamento.
	const unauthorized = [summary, categories, cards, accounts, installments, recent].some(
		(q) => q.error instanceof ApiError && q.error.status === 401,
	);
	if (unauthorized) void signOut();

	const onRefresh = async () => {
		setRefreshing(true);
		try {
			await queryClient.invalidateQueries();
		} finally {
			setRefreshing(false);
		}
	};

	const failure = summary.error ?? categories.error;
	const ready = summary.data && categories.data;

	return (
		<Screen footer={<BottomBar />}>
			<ScrollView
				contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md }}
				refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FFFFFF" />}
			>
				<HomeHeader
					initial={PROFILE_INITIAL}
					hidden={hidden}
					onToggleHidden={toggle}
					onSignOut={() => void signOut()}
				/>

				<View style={{ marginTop: spacing.lg, marginBottom: spacing.sm }}>
					<Text variant="greeting" accessibilityRole="header">
						{greetingFor(hourLocal())}
					</Text>
					<Text variant="caption" tone="secondary" style={{ marginTop: spacing.xs }}>
						{monthName(month)}
						{summary.data?.safeToSpend
							? ` · faltam ${pluralDays(summary.data.safeToSpend.remainingDays)}`
							: ""}
					</Text>
				</View>

				{failure && !ready ? (
					<Card>
						<Text variant="bodyStrong">Não consegui carregar</Text>
						<Text variant="body" tone="secondary" style={{ marginTop: spacing.xs, marginBottom: spacing.lg }}>
							{failure instanceof ApiError ? failure.message : "Algo deu errado. Tente de novo."}
						</Text>
						<Button label="Tentar de novo" variant="secondary" onPress={() => void onRefresh()} />
					</Card>
				) : null}

				{summary.data && categories.data ? (
					<>
						<HeroCard summary={summary.data} categories={categories.data.categories} hidden={hidden} />
						<View style={{ flexDirection: "row", gap: spacing.md }}>
							<InvoiceSquare card={firstCard} invoice={invoice.data} today={today} hidden={hidden} />
							<InstallmentsSquare installments={installments.data} month={month} hidden={hidden} />
						</View>
						<CategoriesCard
							byCategory={summary.data.summary.byCategory}
							categories={categories.data.categories}
							hidden={hidden}
						/>
						<RecentCard
							transactions={recent.data?.transactions ?? []}
							accounts={accounts.data?.accounts ?? []}
							cards={cards.data?.cards ?? []}
							today={today}
							hidden={hidden}
						/>
					</>
				) : failure ? null : (
					<Text variant="body" tone="secondary" accessibilityRole="progressbar">
						Carregando…
					</Text>
				)}
			</ScrollView>
		</Screen>
	);
}
