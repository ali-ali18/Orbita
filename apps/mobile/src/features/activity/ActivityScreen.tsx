import { colors, spacing } from "@orbita/tokens";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, SectionList, View } from "react-native";
import { useClock } from "../../lib/clock.tsx";
import { money } from "../../lib/format.ts";
import { errorMessage } from "../../lib/loadable.ts";
import { usePrivacy } from "../../lib/privacy.tsx";
import {
	BottomBar,
	Button,
	ErrorState,
	IconButton,
	ListRow,
	Screen,
	Skeleton,
	Text,
	TOP_FADE,
	useBottomBarHeight,
} from "../../ui/index.ts";
import { usePendingTransactions } from "../review/queries.ts";
import { ReviewBanner } from "../review/ReviewScreen.tsx";
import { useAccounts, useCards, useCategories } from "../summary/queries.ts";
import { bankBadge } from "../summary/summary-model.ts";
import { TransactionDisc } from "../summary/TransactionDisc.tsx";
import { amountSignMode, amountTone, signedAmount, transactionIcon } from "../summary/transaction-model.ts";
import {
	type ActivityFilter,
	type ActivityTransaction,
	activityCaption,
	type DayGroup,
	emptyMessage,
	flattenPages,
	groupByDay,
	matchesFilter,
	matchesQuery,
} from "./activity-model.ts";
import { FilterChips } from "./FilterChips.tsx";
import { useActivityTransactions } from "./queries.ts";
import { SearchField } from "./SearchField.tsx";

/**
 * Tela "Atividades" (Figma 24:142): todos os lançamentos por dia, com rolagem infinita. A API só pagina
 * (não filtra), então Tudo/Saídas/Entradas/Cartão e a busca valem sobre o que já foi carregado. A gaveta
 * A gaveta "Filtros" (51:918) ainda não existe. O aviso "para revisar" abre a tela quando há pendência.
 */
export function ActivityScreen() {
	const router = useRouter();
	const { hidden, toggle } = usePrivacy();
	const { today } = useClock();
	const bottomBarHeight = useBottomBarHeight();
	const [filter, setFilter] = useState<ActivityFilter>("all");
	const [query, setQuery] = useState("");

	const q = useActivityTransactions();
	const pending = usePendingTransactions();
	const accountsQ = useAccounts();
	const cardsQ = useCards();
	const categoriesQ = useCategories();

	const sources = useMemo(
		() => ({
			accounts: new Map((accountsQ.data?.accounts ?? []).map((a) => [a.id, a])),
			cards: new Map((cardsQ.data?.cards ?? []).map((c) => [c.id, c])),
			categories: new Map((categoriesQ.data?.categories ?? []).map((c) => [c.id, c])),
		}),
		[accountsQ.data, cardsQ.data, categoriesQ.data],
	);

	const loaded = useMemo(() => flattenPages(q.data?.pages ?? []), [q.data]);
	const sections = useMemo(() => {
		const visible = loaded.filter(
			(t) =>
				matchesFilter(t, filter) &&
				matchesQuery(t, t.categoryId ? sources.categories.get(t.categoryId)?.name : undefined, query),
		);
		return groupByDay(visible, today).map((g) => ({ ...g, data: g.items }));
	}, [loaded, filter, query, today, sources.categories]);

	const hasMore = q.hasNextPage;
	const [refreshing, setRefreshing] = useState(false);
	const onRefresh = async () => {
		setRefreshing(true);
		try {
			await q.refetch();
		} finally {
			setRefreshing(false);
		}
	};

	const header = (
		<View style={{ gap: spacing.md, paddingBottom: spacing.sm }}>
			<View
				style={{ height: 100, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
			>
				<IconButton
					icon={hidden ? "olho-cortado" : "olho"}
					label={hidden ? "Mostrar valores" : "Esconder valores"}
					onPress={toggle}
				/>
				<IconButton
					icon="mais"
					iconSize={22}
					label="Novo lançamento"
					filled
					onPress={() => router.push("/novo")}
				/>
			</View>
			<Text variant="greeting" accessibilityRole="header" style={{ paddingTop: spacing.xs }}>
				Atividades
			</Text>
			<SearchField value={query} onChange={setQuery} />
			<FilterChips value={filter} onChange={setFilter} />
			{pending.data && pending.data.transactions.length > 0 ? (
				<ReviewBanner
					count={pending.data.transactions.length}
					hasMore={pending.data.hasMore}
					onPress={() => router.push("/revisao")}
				/>
			) : null}
		</View>
	);

	const renderRow = (t: ActivityTransaction) => {
		const source = t.cardId
			? sources.cards.get(t.cardId)
			: t.accountId
				? sources.accounts.get(t.accountId)
				: undefined;
		const category = t.categoryId ? sources.categories.get(t.categoryId) : undefined;
		return (
			<ListRow
				onPress={() => router.push({ pathname: "/lancamento/[id]", params: { id: t.id } })}
				leading={
					<TransactionDisc
						icon={transactionIcon(t.kind, category?.slug)}
						bank={source ? bankBadge(source) : undefined}
					/>
				}
				title={t.description}
				caption={activityCaption(t, category?.name, sources)}
				value={money(signedAmount(t), hidden, { sign: amountSignMode(t.kind) })}
				valueTone={amountTone(t.kind)}
				{...(t.status === "pending" ? { badge: "Pendente" } : {})}
			/>
		);
	};

	const renderSectionHeader = (g: DayGroup<ActivityTransaction>) => (
		<View
			style={{
				flexDirection: "row",
				alignItems: "center",
				paddingTop: spacing.sm + spacing.sm,
				paddingBottom: spacing.xs,
				backgroundColor: colors.background,
			}}
		>
			<Text variant="bodyStrong" accessibilityRole="header" style={{ flex: 1 }}>
				{g.label}
			</Text>
			<Text variant="caption" tone="secondary">
				{money(g.total, hidden, { sign: "auto" })}
			</Text>
		</View>
	);

	const initialLoading = q.isPending && q.fetchStatus !== "paused" && !q.isError;
	const initialError = q.data === undefined && (q.isError || (q.isPending && q.fetchStatus === "paused"));

	const body = initialLoading ? (
		<View accessibilityLabel="Carregando" style={{ gap: spacing.lg, paddingTop: spacing.md }}>
			{Array.from({ length: 6 }, (_, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: linhas de esqueleto fixas
				<Skeleton key={i} height={44} />
			))}
		</View>
	) : initialError ? (
		<View style={{ paddingTop: spacing.md }}>
			<ErrorState
				message={
					q.isError
						? errorMessage(q.error)
						: "Não consegui falar com o servidor. Confira o endereço e a sua conexão."
				}
				onRetry={() => void q.refetch()}
			/>
		</View>
	) : null;

	const footer = body ? null : q.isFetchNextPageError ? (
		<View style={{ paddingTop: spacing.lg }}>
			<ErrorState message={errorMessage(q.error)} onRetry={() => void q.fetchNextPage()} />
		</View>
	) : q.isFetchingNextPage ? (
		<View style={{ paddingVertical: spacing.xl }} accessibilityLabel="Carregando mais lançamentos">
			<ActivityIndicator color={colors.textSecondary} />
		</View>
	) : hasMore ? (
		// Quando o filtro esconde quase tudo a lista fica curta demais para disparar a rolagem: o botão garante o caminho.
		<View style={{ paddingTop: spacing.lg, alignItems: "center" }}>
			<Button label="Carregar mais" variant="secondary" compact onPress={() => void q.fetchNextPage()} />
		</View>
	) : loaded.length > 0 ? (
		<Text variant="caption" tone="tertiary" style={{ textAlign: "center", paddingTop: spacing.xl }}>
			Fim da lista
		</Text>
	) : null;

	return (
		<Screen
			fadeTop
			footer={
				<BottomBar
					onHome={() => router.dismissTo("/")}
					onNew={() => router.push("/novo")}
					onAsk={() => router.push("/chat")}
				/>
			}
			floatingFooter
		>
			<SectionList<ActivityTransaction, DayGroup<ActivityTransaction> & { data: ActivityTransaction[] }>
				sections={body ? [] : sections}
				keyExtractor={(t) => t.id}
				renderItem={({ item }) => renderRow(item)}
				renderSectionHeader={({ section }) => renderSectionHeader(section)}
				stickySectionHeadersEnabled={false}
				ListHeaderComponent={header}
				ListEmptyComponent={
					body ?? (
						<Text variant="body" tone="secondary" style={{ paddingTop: spacing.md }}>
							{emptyMessage(filter, query, Boolean(hasMore))}
						</Text>
					)
				}
				ListFooterComponent={footer ?? undefined}
				onEndReached={() => {
					if (hasMore && !q.isFetchingNextPage && !q.isFetchNextPageError) void q.fetchNextPage();
				}}
				onEndReachedThreshold={0.6}
				keyboardShouldPersistTaps="handled"
				keyboardDismissMode="on-drag"
				contentContainerStyle={{
					paddingTop: TOP_FADE,
					paddingHorizontal: spacing.lg,
					paddingBottom: bottomBarHeight + spacing.lg,
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
			/>
		</Screen>
	);
}
