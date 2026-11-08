import { colors, radius, spacing } from "@orbita/tokens";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useClock } from "../../lib/clock.tsx";
import { arrivedLabel, money } from "../../lib/format.ts";
import { errorMessage, toLoadable } from "../../lib/loadable.ts";
import { usePrivacy } from "../../lib/privacy.tsx";
import { Button, ErrorState, Icon, IconButton, Screen, Skeleton, Text } from "../../ui/index.ts";
import { useAccounts, useCards, useCategories } from "../summary/queries.ts";
import { bankBadge } from "../summary/summary-model.ts";
import { TransactionDisc } from "../summary/TransactionDisc.tsx";
import { amountSignMode, amountTone, signedAmount, transactionIcon } from "../summary/transaction-model.ts";
import { categoryDot } from "../transactions/new-transaction-model.ts";
import { useConfirmPending, usePendingTransactions } from "./queries.ts";
import {
	confirmAllLabel,
	reviewBannerTitle,
	reviewIntro,
	reviewOrigin,
	reviewSourceIcon,
} from "./review-model.ts";

/** Faixa "N lançamentos para revisar". Some quando não há pendência. */
export function ReviewBanner({
	count,
	hasMore,
	onPress,
}: {
	count: number;
	hasMore: boolean;
	onPress: () => void;
}) {
	if (count <= 0) return null;
	const title = reviewBannerTitle(count, hasMore);
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={title}
			onPress={onPress}
			style={({ pressed }) => ({
				flexDirection: "row",
				alignItems: "center",
				gap: spacing.md,
				backgroundColor: colors.surface,
				borderRadius: radius.block,
				paddingHorizontal: spacing.lg,
				paddingVertical: spacing.md,
				minHeight: 85,
				opacity: pressed ? 0.8 : 1,
			})}
		>
			<View
				style={{
					width: 36,
					height: 36,
					borderRadius: radius.pill,
					backgroundColor: colors.surface3,
					alignItems: "center",
					justifyContent: "center",
				}}
			>
				<Icon name="revisar" size={18} />
			</View>
			<View style={{ flex: 1, gap: 2 }}>
				<Text variant="bodyStrong">{title}</Text>
				<Text variant="caption" tone="secondary">
					Ainda não foram confirmados.
				</Text>
			</View>
			<Icon name="seta-direita" size={18} color={colors.textSecondary} />
		</Pressable>
	);
}

/** Tela "Para revisar" (Figma 36:505): o que chegou sozinho, antes de entrar nos números. */
export function ReviewScreen() {
	const router = useRouter();
	const { today } = useClock();
	const { hidden } = usePrivacy();
	const pending = toLoadable(usePendingTransactions());
	const accounts = useAccounts();
	const cards = useCards();
	const categories = useCategories();
	const confirm = useConfirmPending();
	const [confirmingAll, setConfirmingAll] = useState(false);
	const [message, setMessage] = useState<string | null>(null);

	const accountById = new Map((accounts.data?.accounts ?? []).map((account) => [account.id, account]));
	const cardById = new Map((cards.data?.cards ?? []).map((card) => [card.id, card]));
	const categoryById = new Map(
		(categories.data?.categories ?? []).map((category) => [category.id, category]),
	);

	const confirmOne = async (id: string) => {
		setMessage(null);
		try {
			await confirm.mutateAsync(id);
		} catch (error) {
			setMessage(errorMessage(error));
		}
	};

	return (
		<Screen>
			<ScrollView
				contentContainerStyle={{
					paddingHorizontal: spacing.lg,
					paddingBottom: spacing.xxxl,
					gap: spacing.md,
				}}
			>
				<View style={{ height: 100, justifyContent: "center", alignItems: "flex-start" }}>
					<IconButton
						icon="voltar"
						label="Voltar"
						onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
					/>
				</View>

				{pending.phase === "error" ? (
					<ErrorState message={pending.message} onRetry={pending.retry} />
				) : pending.phase !== "ready" ? (
					<View accessibilityLabel="Carregando revisão" style={{ gap: spacing.lg }}>
						<Skeleton width="50%" height={34} />
						<Skeleton height={220} />
					</View>
				) : pending.data.transactions.length === 0 ? (
					<View style={{ gap: spacing.xs }}>
						<Text variant="greeting" accessibilityRole="header">
							Para revisar
						</Text>
						<Text variant="body" tone="secondary">
							Nada chegou sozinho. Quando uma notificação ou um comprovante virar lançamento, ele aparece
							aqui.
						</Text>
					</View>
				) : (
					<>
						<View style={{ gap: spacing.xs }}>
							<Text variant="greeting" accessibilityRole="header">
								Para revisar
							</Text>
							<Text variant="body" tone="secondary">
								{reviewIntro(pending.data.transactions.length, pending.data.hasMore)}
							</Text>
						</View>
						{pending.data.transactions.map((item) => {
							const card = item.cardId ? cardById.get(item.cardId) : undefined;
							const account = item.accountId ? accountById.get(item.accountId) : undefined;
							const place = card?.name ?? account?.name ?? null;
							const source = card ?? account;
							const category = item.categoryId ? categoryById.get(item.categoryId) : undefined;
							const quote = item.note?.trim() ?? "";
							const busy = confirmingAll || (confirm.isPending && confirm.variables === item.id);
							return (
								<View
									key={item.id}
									style={{
										backgroundColor: colors.surface,
										borderRadius: radius.block,
										padding: spacing.lg,
										gap: spacing.md,
									}}
								>
									<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
										<Icon name={reviewSourceIcon(item.source)} size={16} color={colors.textSecondary} />
										<Text variant="caption" tone="secondary" style={{ flex: 1 }} numberOfLines={1}>
											{reviewOrigin(item.source, place)}
										</Text>
										<Text variant="caption" tone="secondary">
											{arrivedLabel(item.createdAt, today)}
										</Text>
									</View>
									{quote.length > 0 ? (
										<View
											style={{
												backgroundColor: colors.surface3,
												borderRadius: radius.inner,
												padding: spacing.md,
											}}
										>
											<Text variant="caption" tone="secondary">
												{`“${quote}”`}
											</Text>
										</View>
									) : null}
									<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
										<TransactionDisc
											icon={transactionIcon(item.kind, category?.slug)}
											bank={source ? bankBadge(source) : undefined}
										/>
										<View style={{ flex: 1, gap: spacing.xs }}>
											<Text variant="bodyStrong" numberOfLines={1}>
												{item.description}
											</Text>
											<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
												{category ? (
													<View
														style={{
															flexDirection: "row",
															alignItems: "center",
															gap: 6,
															backgroundColor: colors.surface3,
															borderRadius: radius.pill,
															paddingHorizontal: spacing.sm,
															paddingVertical: 3,
														}}
													>
														<View
															style={{
																width: 6,
																height: 6,
																borderRadius: radius.pill,
																backgroundColor: categoryDot(category.chartSlot),
															}}
														/>
														<Text variant="micro" tone="secondary">
															{category.name}
														</Text>
													</View>
												) : null}
												{place ? (
													<Text variant="caption" tone="secondary" numberOfLines={1} style={{ flex: 1 }}>
														{place}
													</Text>
												) : null}
											</View>
										</View>
										<Text variant="bodyStrong" tone={amountTone(item.kind)}>
											{money(signedAmount(item), hidden, { sign: amountSignMode(item.kind) })}
										</Text>
									</View>
									<View style={{ flexDirection: "row", gap: spacing.sm }}>
										<Button
											label="Confirmar"
											icon="check"
											compact
											loading={busy}
											onPress={() => void confirmOne(item.id)}
											style={{ flex: 1 }}
										/>
										<Button
											label="Editar"
											variant="secondary"
											compact
											disabled={busy}
											onPress={() => router.push({ pathname: "/lancamento/[id]", params: { id: item.id } })}
											style={{ flex: 1 }}
										/>
									</View>
								</View>
							);
						})}
						{message ? (
							<Text variant="caption" tone="secondary">
								{message}
							</Text>
						) : null}
						<Button
							label={confirmAllLabel(pending.data.transactions.length, pending.data.hasMore)}
							variant="secondary"
							loading={confirmingAll}
							onPress={() => {
								const ids = pending.data.transactions.map((item) => item.id);
								setConfirmingAll(true);
								setMessage(null);
								void (async () => {
									try {
										for (const id of ids) await confirm.mutateAsync(id);
									} catch (error) {
										setMessage(errorMessage(error));
									} finally {
										setConfirmingAll(false);
									}
								})();
							}}
						/>
					</>
				)}
			</ScrollView>
		</Screen>
	);
}
