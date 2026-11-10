import { spacing } from "@orbita/tokens";
import { useRouter } from "expo-router";
import { Pressable, View } from "react-native";
import type { CategoriesView, MonthSummary } from "../../lib/api.ts";
import { formatWholeReais, money } from "../../lib/format.ts";
import type { Loadable } from "../../lib/loadable.ts";
import { Card, ErrorState, ProgressBar, Skeleton, Text, useWidgetLongPress } from "../../ui/index.ts";
import { budgetAlertNotice, categoryShares, heroBarParts, heroModel } from "./summary-model.ts";

/** Mesmo valor de `TOTAL_BUDGET_SCOPE` em `@orbita/db` (o app não importa o banco). */
const TOTAL_BUDGET_SCOPE = "total";

const TITLE = "Dá pra gastar até o fim do mês";

/** "Gasto R$ X" que abre o Gasto do mês (a linha dia a dia; de lá vai a "Como chegamos nesse número"). */
function SpentLine({ month, cents, hidden }: { month: string; cents: number; hidden: boolean }) {
	const router = useRouter();
	const longPress = useWidgetLongPress();
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={`Gasto ${hidden ? "escondido" : money(cents, false, { sign: "never" })}, ver o gasto do mês`}
			hitSlop={8}
			onPress={() => router.push({ pathname: "/gasto-do-mes", params: { mes: month } })}
			onLongPress={longPress}
			style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
		>
			<Text variant="caption" tone="secondary" style={{ textDecorationLine: "underline" }}>
				Gasto {money(cents, hidden, { sign: "never" })}
			</Text>
		</Pressable>
	);
}

/** O card herói do Início. No erro fica sem a borda de destaque. */
function Shell({
	title = TITLE,
	highlight = true,
	children,
}: {
	title?: string;
	highlight?: boolean;
	children: React.ReactNode;
}) {
	return (
		<Card highlight={highlight}>
			<Text variant="cardTitle" tone="secondary">
				{title}
			</Text>
			{children}
		</Card>
	);
}

export function HeroCard({
	state,
	hidden,
	compact = false,
}: {
	state: Loadable<[MonthSummary, CategoriesView]>;
	hidden: boolean;
	/** 2x4: o número e uma linha de apoio, sem a barra e o "Gasto". */
	compact?: boolean;
}) {
	if (state.phase === "loading") {
		return (
			<Shell>
				<View accessibilityLabel="Carregando" style={{ marginTop: spacing.md, gap: spacing.md }}>
					<Skeleton width="70%" height={46} />
					<Skeleton width="80%" height={18} />
					<Skeleton height={8} />
				</View>
			</Shell>
		);
	}
	if (state.phase === "error") {
		return (
			<Shell highlight={false}>
				<View style={{ marginTop: spacing.md }}>
					<ErrorState message={state.message} onRetry={state.retry} />
				</View>
			</Shell>
		);
	}

	const [summary, { categories }] = state.data;
	const total = summary.budgets.find((b) => b.scope === TOTAL_BUDGET_SCOPE);
	const safe = summary.safeToSpend;
	const spent = summary.summary.spentCents;
	const invested = summary.summary.investedCents;
	// Aviso dentro do app enquanto o push não existe; a decisão é do servidor (`alert`).
	const notice = budgetAlertNotice(summary.budgets, categories, summary.budgetAlertPercent);

	if (!total || !safe) {
		return (
			<Shell>
				<Text variant="body" tone="secondary" style={{ marginTop: spacing.md }}>
					Ainda não há orçamento para este mês. Defina um limite para ver quanto ainda dá pra gastar.
				</Text>
				<View style={{ marginTop: spacing.lg }}>
					<SpentLine month={summary.month} cents={spent} hidden={hidden} />
				</View>
				{invested > 0 ? (
					<Text variant="caption" tone="secondary">
						Investido {money(invested, hidden, { sign: "never" })}
					</Text>
				) : null}
			</Shell>
		);
	}

	const hero = heroModel({
		spentCents: spent,
		limitCents: total.limitCents,
		availableCents: safe.availableCents,
		reservedCents: summary.pendingRecurring.expenseCents,
	});
	const bar = heroBarParts(categoryShares(summary.summary.byCategory, categories), hero);
	const masked = (cents: number) => (hidden ? money(0, true) : formatWholeReais(cents));
	const bigValue = hero.overBudget
		? money(hero.availableCents, hidden)
		: money(Math.max(0, hero.availableCents), hidden);

	const title = hero.overBudget ? "Você passou do orçamento do mês" : TITLE;
	const caption = hero.overBudget
		? `Passou ${masked(spent - hero.limitCents)} do orçamento de ${masked(hero.limitCents)}`
		: hero.reserveExceeds
			? `${masked(hero.reservedCents)} reservados para contas do mês`
			: `≈ ${masked(safe.perDayCents)} por dia · orçamento de ${masked(hero.limitCents)}`;
	if (compact) {
		return (
			<Shell title={title}>
				<Text
					variant="numberHero"
					style={{ marginTop: spacing.xs }}
					adjustsFontSizeToFit
					numberOfLines={1}
					accessibilityLabel={hidden ? "Valor escondido" : undefined}
				>
					{bigValue}
				</Text>
				<Text variant="caption" tone="secondary" style={{ marginTop: spacing.sm }}>
					{caption}
				</Text>
			</Shell>
		);
	}

	return (
		<Shell title={title}>
			<Text
				variant="numberHero"
				style={{ marginTop: spacing.xs }}
				adjustsFontSizeToFit
				numberOfLines={1}
				accessibilityLabel={hidden ? "Valor escondido" : undefined}
			>
				{bigValue}
			</Text>
			<Text variant="caption" tone="secondary" style={{ marginTop: spacing.sm }}>
				{caption}
			</Text>
			<View style={{ marginTop: spacing.xl }}>
				<ProgressBar parts={bar} />
			</View>
			<View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: spacing.xs }}>
				<SpentLine month={summary.month} cents={spent} hidden={hidden} />
				<Text variant="caption" tone="secondary">
					{hero.percent}% do orçamento
				</Text>
			</View>
			{notice ? (
				<Text variant="caption" accessibilityRole="alert" style={{ marginTop: spacing.sm }}>
					{notice}
				</Text>
			) : null}
		</Shell>
	);
}
