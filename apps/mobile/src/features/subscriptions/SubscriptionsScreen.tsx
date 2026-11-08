import { colors, spacing } from "@orbita/tokens";
import { useRouter } from "expo-router";
import { useMemo, useRef, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { useClock } from "../../lib/clock.tsx";
import { money } from "../../lib/format.ts";
import { combineLoadables, errorMessage, toLoadable } from "../../lib/loadable.ts";
import { usePrivacy } from "../../lib/privacy.tsx";
import { Button, Card, ErrorState, IconButton, Screen, Skeleton, Text, TOP_FADE } from "../../ui/index.ts";
import { ServerDownScreen } from "../server/ServerDownScreen.tsx";
import { isUnreachableQuery } from "../server/server-model.ts";
import { useAccounts, useCards } from "../summary/queries.ts";
import { bankBadge } from "../summary/summary-model.ts";
import {
	useMonthTransactions,
	usePostAllSubscriptions,
	useRecurrences,
	useUndoPostedSubscriptions,
} from "./queries.ts";
import { SubscriptionRow } from "./SubscriptionRow.tsx";
import {
	batchMessage,
	chargeCaption,
	countLabel,
	monthlyTotalCents,
	monthStatus,
	nextSummary,
	pendingLabel,
	pendingSummary,
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
	const postAll = usePostAllSubscriptions();
	const undo = useUndoPostedSubscriptions();
	// `isPending` só muda no próximo render; a trava em ref barra o segundo toque no mesmo instante.
	const busy = useRef(false);
	const [message, setMessage] = useState<string | null>(null);
	const [undoIds, setUndoIds] = useState<string[]>([]);
	const [refreshing, setRefreshing] = useState(false);

	const state = combineLoadables(toLoadable(recurrencesQ), toLoadable(monthTxQ));
	const banks = useMemo(() => {
		const byKey = new Map<string, { name: string; bankCode: string | null }>();
		for (const a of accountsQ.data?.accounts ?? []) byKey.set(`account:${a.id}`, a);
		for (const c of cardsQ.data?.cards ?? []) byKey.set(`card:${c.id}`, c);
		return byKey;
	}, [accountsQ.data, cardsQ.data]);

	const close = () => (router.canGoBack() ? router.back() : router.replace("/"));

	const postPending = (ids: readonly string[]) => {
		if (busy.current || ids.length === 0) return;
		busy.current = true;
		setMessage(null);
		setUndoIds([]);
		postAll.mutate(
			{ ids, month },
			{
				onSuccess: (result) => {
					setMessage(batchMessage(result));
					setUndoIds(result.transactionIds);
				},
				onError: (error) => setMessage(errorMessage(error)),
				onSettled: () => {
					busy.current = false;
				},
			},
		);
	};

	const undoPosted = () => {
		if (busy.current || undoIds.length === 0) return;
		busy.current = true;
		const ids = undoIds;
		undo.mutate(ids, {
			onSuccess: () => {
				setUndoIds([]);
				setMessage("Lançamentos desfeitos.");
			},
			onError: (error) => setMessage(errorMessage(error)),
			onSettled: () => {
				busy.current = false;
			},
		});
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
		const pending = pendingSummary(recurrences, month, transactions);
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

				{pending.count > 0 ? (
					<Card style={{ gap: spacing.md, padding: spacing.lg }}>
						<View style={{ gap: 2 }}>
							<Text variant="bodyStrong" accessibilityRole="header">
								{pendingLabel(pending.count)}
							</Text>
							<Text variant="caption" tone="secondary">
								{money(pending.totalCents, hidden, { sign: "never" })}
							</Text>
						</View>
						<Button
							label="Lançar todas"
							compact
							loading={postAll.isPending}
							onPress={() => postPending(pending.ids)}
						/>
					</Card>
				) : null}

				{message ? (
					<View
						accessibilityRole="alert"
						accessibilityLiveRegion="polite"
						style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}
					>
						<Text variant="caption" tone="secondary" style={{ flex: 1 }}>
							{message}
						</Text>
						{undoIds.length > 0 ? (
							<Button
								label="Desfazer"
								variant="secondary"
								compact
								loading={undo.isPending}
								onPress={undoPosted}
							/>
						) : null}
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
										bank={bank ? bankBadge(bank) : undefined}
										onPress={() => router.push({ pathname: "/assinatura", params: { id: r.id } })}
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

	if (isUnreachableQuery(recurrencesQ)) {
		return <ServerDownScreen onRetry={() => recurrencesQ.refetch()} />;
	}

	return (
		<Screen fadeTop>
			<ScrollView
				contentContainerStyle={{
					paddingTop: TOP_FADE,
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
