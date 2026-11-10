import { addMonths } from "@orbita/core";
import { chart, colors, radius, spacing } from "@orbita/tokens";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { useClock } from "../../lib/clock.tsx";
import { money, monthName } from "../../lib/format.ts";
import { toLoadable } from "../../lib/loadable.ts";
import { usePrivacy } from "../../lib/privacy.tsx";
import { useAccent } from "../../lib/theme.tsx";
import { Card, ErrorState, LineChart, Skeleton, Text } from "../../ui/index.ts";
import { BleedRow } from "../card/parts.tsx";
import { ServerDownScreen } from "../server/ServerDownScreen.tsx";
import { isUnreachableQuery } from "../server/server-model.ts";
import { timesLabel, variation } from "./bank-cards-model.ts";
import { DetailScreen } from "./DetailScreen.tsx";
import { useSpendingDaily } from "./queries.ts";

/** Quantos meses o seletor oferece (o atual e os dois anteriores). O mês atual é o padrão. */
const MONTH_CHOICES = 3;

function Legend({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
	return (
		<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
			<View
				style={{
					width: 18,
					height: 0,
					borderTopWidth: 2,
					borderColor: color,
					borderStyle: dashed ? "dashed" : "solid",
				}}
			/>
			<Text variant="caption" tone="secondary">
				{label}
			</Text>
		</View>
	);
}

/**
 * "Gasto do mês": linha acumulada dia a dia do mês e, tracejada, a do mês anterior; a variação contra o mesmo dia
 * do mês anterior e os 3 estabelecimentos que mais pesaram. O mês vem do servidor (`GET /v1/summary/:mês/daily`).
 */
export function SpendingScreen({ month: initialMonth }: { month?: string }) {
	const { accent } = useAccent();
	const router = useRouter();
	const clock = useClock();
	const { hidden } = usePrivacy();
	const [month, setMonth] = useState(initialMonth ?? clock.month);
	const query = useSpendingDaily(month);
	const daily = toLoadable(query);

	if (isUnreachableQuery(query)) return <ServerDownScreen onRetry={() => query.refetch()} />;

	const choices = Array.from({ length: MONTH_CHOICES }, (_, i) => addMonths(clock.month, -i));
	if (!choices.includes(month)) choices.push(month);

	return (
		<DetailScreen title="Gasto do mês" caption="Pela data da compra, na conta e no cartão">
			<BleedRow>
				{choices.map((m) => {
					const active = m === month;
					return (
						<Pressable
							key={m}
							accessibilityRole="button"
							accessibilityState={{ selected: active }}
							onPress={() => setMonth(m)}
							style={{ minHeight: 44, justifyContent: "center" }}
						>
							<View
								style={{
									paddingHorizontal: 14,
									paddingVertical: spacing.sm,
									borderRadius: radius.pill,
									backgroundColor: active ? accent : colors.surface,
									borderWidth: active ? 0 : 1,
									borderColor: colors.border,
								}}
							>
								<Text variant="bodyStrong" tone={active ? "onAccent" : "primary"}>
									{m === clock.month ? "Este mês" : monthName(m)}
								</Text>
							</View>
						</Pressable>
					);
				})}
			</BleedRow>

			{daily.phase === "loading" ? (
				<View accessibilityLabel="Carregando gasto do mês" style={{ gap: spacing.md }}>
					<Skeleton width="60%" height={46} />
					<Skeleton height={200} />
					<Skeleton height={140} />
				</View>
			) : daily.phase === "error" ? (
				<ErrorState message={daily.message} onRetry={daily.retry} />
			) : (
				(() => {
					const data = daily.data;
					const v = variation(data.variancePercent);
					const last = data.current.at(-1)?.cumulativeCents ?? 0;
					const peak = Math.max(1, last, data.previous.at(-1)?.cumulativeCents ?? 0);
					const empty = data.spentCents === 0 && data.previousSpentCents === 0;
					const lastDay = Math.max(data.daysInMonth, data.previous.at(-1)?.day ?? 0);
					return (
						<>
							<Card>
								<Text variant="cardTitle" tone="secondary">
									{monthName(data.month)} até o dia {data.throughDay}
								</Text>
								<Text
									variant="numberHero"
									adjustsFontSizeToFit
									numberOfLines={1}
									style={{ marginTop: spacing.xs }}
								>
									{money(data.spentCents, hidden, { sign: "never" })}
								</Text>
								<Text variant="bodyStrong" accessibilityLabel={v.spoken} style={{ marginTop: spacing.xs }}>
									{v.text}
								</Text>
								{empty ? (
									<Text variant="body" tone="secondary" style={{ marginTop: spacing.lg }}>
										Nenhum gasto neste mês nem no anterior. Quando houver, a linha aparece aqui.
									</Text>
								) : (
									<View style={{ marginTop: spacing.xl, gap: spacing.md }}>
										<LineChart
											height={190}
											xMax={lastDay}
											yMax={peak}
											label={`Gasto acumulado de ${monthName(data.month)} contra ${monthName(data.previousMonth)}`}
											series={[
												{
													key: "previous",
													color: chart.other,
													dashed: true,
													points: data.previous.map((p) => ({ x: p.day, y: p.cumulativeCents })),
												},
												{
													key: "current",
													color: colors.text,
													endDot: true,
													points: data.current.map((p) => ({ x: p.day, y: p.cumulativeCents })),
												},
											]}
										/>
										<View style={{ flexDirection: "row", justifyContent: "space-between" }}>
											<Text variant="micro" tone="secondary">
												dia 1
											</Text>
											<Text variant="micro" tone="secondary">
												dia {Math.ceil(lastDay / 2)}
											</Text>
											<Text variant="micro" tone="secondary">
												dia {lastDay}
											</Text>
										</View>
										<View
											style={{
												flexDirection: "row",
												flexWrap: "wrap",
												columnGap: spacing.lg,
												rowGap: spacing.xs,
											}}
										>
											<Legend color={colors.text} label={monthName(data.month)} />
											<Legend
												color={chart.other}
												dashed
												label={`${monthName(data.previousMonth)} (inteiro)`}
											/>
										</View>
										<Text variant="caption" tone="secondary">
											Mês anterior até o dia {data.throughDay}:{" "}
											{money(data.previousSameDayCents, hidden, { sign: "never" })}
										</Text>
									</View>
								)}
							</Card>

							<Card>
								<Text variant="cardTitle" tone="secondary">
									Onde mais gastou
								</Text>
								{data.topMerchants.length === 0 ? (
									<Text variant="body" tone="secondary" style={{ marginTop: spacing.md }}>
										Nenhum estabelecimento neste mês.
									</Text>
								) : (
									<View style={{ marginTop: spacing.md, gap: spacing.lg }}>
										{data.topMerchants.slice(0, 3).map((m, i) => (
											<View
												key={m.name}
												style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}
											>
												<View
													style={{
														width: 32,
														height: 32,
														borderRadius: radius.pill,
														backgroundColor: colors.surface2,
														alignItems: "center",
														justifyContent: "center",
													}}
												>
													<Text variant="bodyStrong" tone="secondary">
														{i + 1}
													</Text>
												</View>
												<View style={{ flex: 1, gap: 2 }}>
													<Text variant="bodyStrong" numberOfLines={1}>
														{m.name}
													</Text>
													<Text variant="caption" tone="secondary">
														{timesLabel(m.count)}
													</Text>
												</View>
												<Text variant="bodyStrong">{money(m.totalCents, hidden, { sign: "never" })}</Text>
											</View>
										))}
									</View>
								)}
							</Card>

							<Pressable
								accessibilityRole="button"
								onPress={() => router.push({ pathname: "/gasto", params: { mes: data.month } })}
								style={{ minHeight: 44, justifyContent: "center" }}
							>
								<Text variant="caption" tone="secondary" style={{ textDecorationLine: "underline" }}>
									Como chegamos nesse número
								</Text>
							</Pressable>
						</>
					);
				})()
			)}
		</DetailScreen>
	);
}
