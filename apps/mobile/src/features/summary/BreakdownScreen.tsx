import { layout, spacing } from "@orbita/tokens";
import { useRouter } from "expo-router";
import { ScrollView, View } from "react-native";
import { useClock } from "../../lib/clock.tsx";
import { money, monthYear } from "../../lib/format.ts";
import { toLoadable } from "../../lib/loadable.ts";
import { usePrivacy } from "../../lib/privacy.tsx";
import { Card, ErrorState, IconButton, ListRow, Screen, Skeleton, Text } from "../../ui/index.ts";
import { type BreakdownRow, cardGroups, rowCaption, sections } from "./breakdown-model.ts";
import { useBreakdown, useCategories } from "./queries.ts";

/**
 * "Como chegamos nesse número": cada lançamento que somou ao Gasto do mês, agrupado por onde veio (conta ou cartão, com o
 * subtotal de cada cartão). Tudo vem de `GET /v1/summary/:mês/breakdown`; a tela só mostra.
 */
export function BreakdownScreen({ month }: { month?: string }) {
	const router = useRouter();
	const clock = useClock();
	const { hidden } = usePrivacy();
	const target = month ?? clock.month;
	const breakdown = toLoadable(useBreakdown(target));
	const categoriesQ = useCategories();
	const names = new Map((categoriesQ.data?.categories ?? []).map((c) => [c.id, c.name]));

	const renderRow = (r: BreakdownRow) => (
		<ListRow
			key={r.id}
			title={rowTitle(r)}
			caption={caption(r)}
			value={money(r.deltaCents, hidden, { sign: r.deltaCents < 0 ? "always" : "never" })}
			valueTone={r.deltaCents < 0 ? "positive" : "primary"}
			onPress={() => router.push(`/lancamento/${r.id}`)}
		/>
	);
	const rowTitle = (r: BreakdownRow) => r.description || "Sem descrição";
	const caption = (r: BreakdownRow) => {
		const category = r.categoryId ? names.get(r.categoryId) : undefined;
		return [rowCaption(r), category].filter(Boolean).join(" · ");
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
				<View style={{ height: layout.touchTarget, justifyContent: "center", alignItems: "flex-start" }}>
					<IconButton
						icon="voltar"
						label="Voltar"
						onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
					/>
				</View>
				<Text variant="greeting" accessibilityRole="header">
					Como chegamos nesse número
				</Text>
				<Text variant="caption" tone="secondary">
					Gasto de {monthYear(target)}
				</Text>

				{breakdown.phase === "loading" ? (
					<View accessibilityLabel="Carregando" style={{ gap: spacing.md }}>
						<Skeleton width="60%" height={40} />
						<Skeleton height={120} />
						<Skeleton height={120} />
					</View>
				) : breakdown.phase === "error" ? (
					<ErrorState message={breakdown.message} onRetry={breakdown.retry} />
				) : (
					<>
						<Card>
							<Text variant="cardTitle" tone="secondary">
								Gasto do mês
							</Text>
							<Text variant="numberHero" adjustsFontSizeToFit numberOfLines={1}>
								{money(breakdown.data.spentCents, hidden, { sign: "never" })}
							</Text>
							{breakdown.data.rowsCents !== breakdown.data.spentCents ? (
								<Text variant="caption" tone="secondary">
									A soma das linhas é {money(breakdown.data.rowsCents, hidden, { sign: "never" })}: um estorno
									passou do gasto da categoria e não abateu o resto.
								</Text>
							) : null}
						</Card>
						{sections(breakdown.data.rows, breakdown.data.branches).map((section) => (
							<Card key={section.branch}>
								<View style={{ flexDirection: "row", justifyContent: "space-between", gap: spacing.md }}>
									<Text variant="bodyStrong" style={{ flexShrink: 1 }}>
										{section.title}
									</Text>
									<Text variant="bodyStrong">{money(section.subtotalCents, hidden, { sign: "never" })}</Text>
								</View>
								<Text variant="caption" tone="secondary">
									{section.count === 1 ? "1 lançamento" : `${section.count} lançamentos`} · {section.hint}
								</Text>
								<View style={{ marginTop: spacing.sm }}>
									{section.branch === "card"
										? cardGroups(section.rows, breakdown.data.cards).map((group) => (
												<View key={group.cardId} style={{ marginTop: spacing.sm }}>
													<View
														style={{ flexDirection: "row", justifyContent: "space-between", gap: spacing.md }}
													>
														<Text variant="bodyStrong" tone="secondary" style={{ flexShrink: 1 }}>
															{group.title}
														</Text>
														<Text variant="bodyStrong" tone="secondary">
															{money(group.subtotalCents, hidden, { sign: "never" })}
														</Text>
													</View>
													{group.rows.map(renderRow)}
												</View>
											))
										: section.rows.map(renderRow)}
								</View>
							</Card>
						))}
						{breakdown.data.rows.length === 0 ? (
							<Text variant="body" tone="secondary">
								Nada pesou no gasto deste mês.
							</Text>
						) : null}
					</>
				)}
			</ScrollView>
		</Screen>
	);
}
