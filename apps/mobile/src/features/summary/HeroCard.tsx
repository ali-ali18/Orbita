import { spacing } from "@orbita/tokens";
import { View } from "react-native";
import type { CategoriesView, MonthSummary } from "../../lib/api.ts";
import { formatWholeReais, money } from "../../lib/format.ts";
import type { Loadable } from "../../lib/loadable.ts";
import { Card, ErrorState, ProgressBar, Skeleton, Text } from "../../ui/index.ts";
import { categoryShares, heroBarParts, heroModel } from "./summary-model.ts";

/** Mesmo valor de `TOTAL_BUDGET_SCOPE` em `@orbita/db` (o app não importa o banco). */
const TOTAL_BUDGET_SCOPE = "total";

const TITLE = "Dá pra gastar até o fim do mês";

function Shell({ title = TITLE, children }: { title?: string; children: React.ReactNode }) {
	return (
		<Card>
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
}: {
	state: Loadable<[MonthSummary, CategoriesView]>;
	hidden: boolean;
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
			<Shell>
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

	if (!total || !safe) {
		return (
			<Shell>
				<Text variant="body" tone="secondary" style={{ marginTop: spacing.md }}>
					Ainda não há orçamento para este mês. Defina um limite para ver quanto ainda dá pra gastar.
				</Text>
				<Text variant="caption" tone="secondary" style={{ marginTop: spacing.lg }}>
					Gasto {money(spent, hidden, { sign: "never" })}
				</Text>
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

	return (
		<Shell title={hero.overBudget ? "Você passou do orçamento do mês" : TITLE}>
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
				{hero.overBudget
					? `Passou ${masked(spent - hero.limitCents)} do orçamento de ${masked(hero.limitCents)}`
					: hero.reserveExceeds
						? `${masked(hero.reservedCents)} reservados para contas do mês`
						: `≈ ${masked(safe.perDayCents)} por dia · orçamento de ${masked(hero.limitCents)}`}
			</Text>
			{hero.reserveExceeds ? (
				<Text variant="caption" tone="secondary">
					O que falta pagar este mês passa do que sobra.
				</Text>
			) : null}
			<View style={{ marginTop: spacing.xl }}>
				<ProgressBar parts={bar} />
			</View>
			<View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: spacing.xs }}>
				<Text variant="caption" tone="secondary">
					Gasto {money(spent, hidden, { sign: "never" })}
				</Text>
				<Text variant="caption" tone="secondary">
					{hero.percent}% do orçamento
				</Text>
			</View>
			{hero.reservedCents > 0 && !hero.overBudget ? (
				<Text variant="caption" tone="secondary" style={{ marginTop: spacing.xs }}>
					Contas a vencer (listradas) {money(hero.reservedCents, hidden, { sign: "never" })}
				</Text>
			) : null}
		</Shell>
	);
}
