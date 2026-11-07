import { colors, spacing } from "@orbita/tokens";
import { useRouter } from "expo-router";
import { useMemo, useRef, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { ApiError } from "../../lib/api.ts";
import { useClock } from "../../lib/clock.tsx";
import { money } from "../../lib/format.ts";
import { combineLoadables, errorMessage, toLoadable } from "../../lib/loadable.ts";
import { usePrivacy } from "../../lib/privacy.tsx";
import { Button, ErrorState, IconButton, Screen, Skeleton, Text } from "../../ui/index.ts";
import { useAccounts, useCards } from "../summary/queries.ts";
import { bankColor } from "../summary/summary-model.ts";
import { initialOf } from "../summary/transaction-model.ts";
import { useMonthTransactions, usePostSubscription, useRecurrences } from "./queries.ts";
import { SubscriptionRow } from "./SubscriptionRow.tsx";
import {
	chargeCaption,
	countLabel,
	monthlyTotalCents,
	monthStatus,
	nextSummary,
	sortSubscriptions,
} from "./subscriptions-model.ts";

/**
 * Tela "Assinaturas" (Figma 28:450): compromisso mensal, próxima cobrança e a lista com a situação do mês
 * (lançada ou pendente). O card "Achei uma cobrança que se repete" do Figma não existe: a API ainda não
 * detecta cobranças repetidas.
 */
export function SubscriptionsScreen() {
	const router = useRouter();
	const { hidden, toggle } = usePrivacy();
	const { today, month } = useClock();
	const recurrencesQ = useRecurrences();
	const monthTxQ = useMonthTransactions(month);
	const accountsQ = useAccounts();
	const cardsQ = useCards();
	const post = usePostSubscription();
	const posting = useRef(false);
	const [postingId, setPostingId] = useState<string | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const [refreshing, setRefreshing] = useState(false);

	const state = combineLoadables(toLoadable(recurrencesQ), toLoadable(monthTxQ));
	const banks = useMemo(() => {
		const byKey = new Map<string, { name: string; bankCode: string | null }>();
		for (const a of accountsQ.data?.accounts ?? []) byKey.set(`account:${a.id}`, a);
		for (const c of cardsQ.data?.cards ?? []) byKey.set(`card:${c.id}`, c);
		return byKey;
	}, [accountsQ.data, cardsQ.data]);

	const close = () => (router.canGoBack() ? router.back() : router.replace("/"));

	const postNow = (id: string) => {
		if (posting.current) return;
		posting.current = true;
		setPostingId(id);
		setMessage(null);
		post.mutate(
			{ id, month },
			{
				// 409 = já estava lançada (por fora do app): a lista recarrega e a linha passa a "lançada".
				onError: (error) =>
					setMessage(
						error instanceof ApiError && error.status === 409
							? "Essa assinatura já estava lançada neste mês."
							: errorMessage(error),
					),
				onSettled: () => {
					posting.current = false;
					setPostingId(null);
				},
			},
		);
	};

	const onRefresh = async () => {
		setRefreshing(true);
		try {
			await Promise.all([recurrencesQ.refetch(), monthTxQ.refetch()]);
		} finally {
			setRefreshing(false);
		}
	};

	const renderBody = () => {
		if (state.phase === "loading") {
			return (
				<View accessibilityLabel="Carregando" style={{ gap: spacing.lg }}>
					<Skeleton height={96} />
					{[0, 1, 2].map((i) => (
						<Skeleton key={i} height={48} />
					))}
				</View>
			);
		}
		if (state.phase === "error") return <ErrorState message={state.message} onRetry={state.retry} />;
		const [{ recurrences }, { transactions }] = state.data;
		const list = sortSubscriptions(recurrences, today);
		const total = monthlyTotalCents(recurrences, month);
		const next = nextSummary(recurrences, today);
		return (
			<>
				<View style={{ paddingTop: spacing.sm, gap: spacing.xs }}>
					<Text variant="cardTitle" tone="secondary" accessibilityRole="header">
						Compromisso mensal
					</Text>
					<Text variant="numberHero">{money(total, hidden, { sign: "never" })}</Text>
					{next ? (
						<Text variant="caption" tone="secondary">
							{next}
						</Text>
					) : null}
				</View>

				{message ? (
					<View accessibilityRole="alert" accessibilityLiveRegion="polite">
						<Text variant="caption" tone="secondary">
							{message}
						</Text>
					</View>
				) : null}

				{list.length === 0 ? (
					<View style={{ gap: spacing.md, paddingTop: spacing.md }}>
						<Text variant="body" tone="secondary">
							Nenhuma assinatura ainda. Adicione as cobranças que se repetem todo mês para ver quanto elas
							pesam.
						</Text>
					</View>
				) : (
					<>
						<View style={{ flexDirection: "row", paddingTop: spacing.sm }}>
							<Text variant="cardTitle" tone="secondary" style={{ flex: 1 }}>
								{countLabel(list.length)}
							</Text>
							<Text variant="cardTitle" tone="secondary">
								{`${money(total, hidden, { sign: "never" })} por mês`}
							</Text>
						</View>
						<View style={{ gap: spacing.xs }}>
							{list.map((r) => {
								const status = monthStatus(r, month, transactions);
								const bank = banks.get(r.cardId ? `card:${r.cardId}` : `account:${r.accountId}`);
								return (
									<SubscriptionRow
										key={r.id}
										name={r.name}
										caption={chargeCaption(r, status, today, month)}
										value={money(r.amountCents, hidden, { sign: "never" })}
										status={status}
										bank={
											bank ? { initial: initialOf(bank.name), color: bankColor(bank.bankCode) } : undefined
										}
										posting={postingId === r.id}
										onPress={() => router.push({ pathname: "/assinatura", params: { id: r.id } })}
										onPostNow={() => postNow(r.id)}
									/>
								);
							})}
						</View>
					</>
				)}

				<View style={{ alignItems: "center", paddingTop: spacing.sm }}>
					<Button
						label="Adicionar assinatura"
						variant="secondary"
						icon="mais"
						onPress={() => router.push("/assinatura")}
					/>
				</View>
			</>
		);
	};

	return (
		<Screen>
			<ScrollView
				contentContainerStyle={{
					paddingHorizontal: spacing.lg,
					paddingBottom: spacing.xxxl,
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
				<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44 }}>
					<IconButton icon="voltar" label="Voltar" onPress={close} />
					<View style={{ flex: 1 }} />
					<IconButton
						icon={hidden ? "olho-cortado" : "olho"}
						label={hidden ? "Mostrar valores" : "Esconder valores"}
						onPress={toggle}
					/>
					<IconButton
						icon="mais"
						iconSize={22}
						label="Nova assinatura"
						filled
						onPress={() => router.push("/assinatura")}
					/>
				</View>
				{renderBody()}
			</ScrollView>
		</Screen>
	);
}
