import { colors, radius, spacing } from "@orbita/tokens";
import { useRouter } from "expo-router";
import { View } from "react-native";
import { useClock } from "../../lib/clock.tsx";
import { money } from "../../lib/format.ts";
import { toLoadable } from "../../lib/loadable.ts";
import { usePrivacy } from "../../lib/privacy.tsx";
import { BankLogo, Button, ErrorState, Skeleton, Text } from "../../ui/index.ts";
import { useNow } from "../banks/use-now.ts";
import { Notice } from "../card/parts.tsx";
import { ServerDownScreen } from "../server/ServerDownScreen.tsx";
import { isUnreachableQuery } from "../server/server-model.ts";
import { accountKindLabel, sortBalanceLines, withoutBalanceNotice } from "./balances-model.ts";
import { accountsCountLabel, freshnessLabel } from "./bank-cards-model.ts";
import { DetailScreen } from "./DetailScreen.tsx";
import {
	useAccountBalances,
	useAccounts,
	useCards,
	useCategories,
	useRecentTransactions,
} from "./queries.ts";
import { RecentCard } from "./RecentCard.tsx";
import { bankBadge } from "./summary-model.ts";

/**
 * "Saldo em contas": o total que o banco informou e uma linha por conta (logo, nome, saldo, parte do total).
 * Conta sem saldo do banco aparece marcada e fica fora do total. Embaixo, os últimos lançamentos.
 */
export function BalancesScreen() {
	const router = useRouter();
	const { hidden } = usePrivacy();
	const { today } = useClock();
	const now = useNow();
	const balancesQuery = useAccountBalances();
	const balances = toLoadable(balancesQuery);
	const recentQ = useRecentTransactions(5);
	const accountsQ = useAccounts();
	const cardsQ = useCards();
	const categoriesQ = useCategories();

	if (isUnreachableQuery(balancesQuery)) {
		return <ServerDownScreen onRetry={() => balancesQuery.refetch()} />;
	}

	// A idade da leitura aparece só aqui, no detalhe; no Início e em cada conta ela só repetiria.
	const caption =
		balances.phase === "ready"
			? [accountsCountLabel(balances.data.accounts.length), freshnessLabel(balances.data.oldestSyncedAt, now)]
					.filter(Boolean)
					.join(" · ")
			: null;

	return (
		<DetailScreen title="Saldo em contas" caption={caption}>
			{balances.phase === "loading" ? (
				<View accessibilityLabel="Carregando saldos" style={{ gap: spacing.md }}>
					<Skeleton width="60%" height={46} />
					<Skeleton height={72} />
					<Skeleton height={72} />
				</View>
			) : balances.phase === "error" ? (
				<ErrorState message={balances.message} onRetry={balances.retry} />
			) : balances.data.accounts.length === 0 ? (
				<View style={{ gap: spacing.lg, alignItems: "flex-start" }}>
					<Text variant="body" tone="secondary">
						Você ainda não tem conta. Conecte um banco para trazer o saldo de cada uma.
					</Text>
					<Button label="Conectar um banco" onPress={() => router.push("/configuracoes/bancos")} />
				</View>
			) : (
				<>
					<View style={{ gap: spacing.xs, paddingVertical: spacing.sm }}>
						<Text variant="numberHero" adjustsFontSizeToFit numberOfLines={1}>
							{balances.data.accounts.length === balances.data.withoutBalanceCount
								? "—"
								: money(balances.data.totalCents, hidden)}
						</Text>
					</View>
					{withoutBalanceNotice(balances.data.withoutBalanceCount) ? (
						<Notice text={withoutBalanceNotice(balances.data.withoutBalanceCount) ?? ""} />
					) : null}
					{sortBalanceLines(balances.data.accounts).map((a) => (
						<View
							key={a.accountId}
							accessible
							accessibilityLabel={`${a.name}, ${
								a.hasBalance ? money(a.balanceCents ?? 0, hidden) : "sem saldo do banco"
							}`}
							style={{
								gap: spacing.md,
								padding: 18,
								borderRadius: radius.block,
								backgroundColor: colors.surface,
							}}
						>
							<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
								<BankLogo {...bankBadge({ name: a.name, bankCode: a.bankCode })} size={40} />
								<View style={{ flex: 1, gap: 2 }}>
									<Text variant="bodyStrong" numberOfLines={1}>
										{a.name}
									</Text>
									<Text variant="caption" tone="secondary" numberOfLines={1}>
										{a.hasBalance ? accountKindLabel(a.kind) : "Sem saldo do banco"}
									</Text>
								</View>
								{a.hasBalance ? (
									<Text variant="bodyStrong">{money(a.balanceCents ?? 0, hidden)}</Text>
								) : (
									<View
										style={{
											paddingHorizontal: spacing.sm,
											paddingVertical: 2,
											borderRadius: radius.pill,
											backgroundColor: colors.surface3,
										}}
									>
										<Text variant="micro" tone="secondary">
											sem saldo
										</Text>
									</View>
								)}
							</View>
							{a.hasBalance && a.sharePercent !== null ? (
								<View style={{ gap: spacing.xs }}>
									<View
										accessibilityRole="progressbar"
										accessibilityLabel={`${a.sharePercent}% do total`}
										style={{
											height: 6,
											borderRadius: 3,
											backgroundColor: colors.surface3,
											overflow: "hidden",
										}}
									>
										<View
											style={{
												width: `${Math.min(100, Math.max(a.sharePercent > 0 ? 3 : 0, a.sharePercent))}%`,
												height: 6,
												borderRadius: 3,
												backgroundColor: colors.text,
											}}
										/>
									</View>
								</View>
							) : null}
						</View>
					))}
					<RecentCard
						state={toLoadable(recentQ)}
						accounts={accountsQ.data?.accounts ?? []}
						cards={cardsQ.data?.cards ?? []}
						categories={categoriesQ.data?.categories ?? []}
						today={today}
						hidden={hidden}
						onSeeAll={() => router.push("/atividades")}
						onOpen={(id) => router.push({ pathname: "/lancamento/[id]", params: { id } })}
					/>
				</>
			)}
		</DetailScreen>
	);
}
