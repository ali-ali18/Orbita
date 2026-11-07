import { colors, radius, spacing } from "@orbita/tokens";
import { useMemo } from "react";
import { View } from "react-native";
import { useClock } from "../../lib/clock.tsx";
import { money } from "../../lib/format.ts";
import { toLoadable } from "../../lib/loadable.ts";
import { BankLogo, ErrorState, ProgressBar, Skeleton, Text } from "../../ui/index.ts";
import { useInstallments } from "../summary/queries.ts";
import { bankBadge } from "../summary/summary-model.ts";
import {
	bestPurchaseDay,
	type CardLike,
	cardColor,
	cardLabel,
	cycleLabel,
	limitBar,
	limitsOverview,
	openInvoiceMonth,
	usageMonths,
	usagePercent,
	usedLimitCents,
} from "./card-model.ts";
import { BigNumber, Notice } from "./parts.tsx";
import { useInvoiceTotals } from "./queries.ts";

/** Aba Limites: disponível somando os cartões e o uso de cada um (estimado: o banco não manda o disponível). */
export function LimitsTab({ cards, hidden }: { cards: readonly CardLike[]; hidden: boolean }) {
	const { today } = useClock();
	const installments = toLoadable(useInstallments());
	const pairs = useMemo(
		() => cards.flatMap((c) => usageMonths(c, today).map((month) => ({ cardId: c.id, month }))),
		[cards, today],
	);
	const invoiceQs = useInvoiceTotals(pairs);

	const failed = invoiceQs.find((q) => q.data === undefined && q.isError);
	if (installments.phase === "error")
		return <ErrorState message={installments.message} onRetry={installments.retry} />;
	if (failed) {
		return (
			<ErrorState
				message="Não consegui carregar as faturas para calcular o uso do limite."
				onRetry={() => {
					for (const q of invoiceQs) void q.refetch();
				}}
			/>
		);
	}
	if (installments.phase === "loading" || invoiceQs.some((q) => q.data === undefined)) {
		return (
			<View accessibilityLabel="Carregando limites" style={{ gap: spacing.lg }}>
				<Skeleton width="60%" height={40} />
				<Skeleton height={10} />
				<Skeleton height={150} />
			</View>
		);
	}

	const rows = cards.map((card) => {
		const totals = pairs.flatMap((p, i) =>
			p.cardId === card.id ? [invoiceQs[i]?.data?.composition.totalCents ?? 0] : [],
		);
		const usedCents = usedLimitCents(
			totals,
			installments.data.groups,
			card.id,
			openInvoiceMonth(card, today),
		);
		return { card, cardId: card.id, limitCents: card.limitCents, usedCents, color: cardColor(card) };
	});
	const overview = limitsOverview(rows);

	if (overview.countedCards === 0) {
		return (
			<View style={{ gap: spacing.lg }}>
				<BigNumber
					label="Limite disponível"
					value="—"
					caption="O banco não informou o limite dos seus cartões."
				/>
				<Notice text="Quando a sincronização trouxer o limite, o uso de cada cartão aparece aqui." />
			</View>
		);
	}

	return (
		<View style={{ gap: spacing.lg }}>
			<BigNumber
				label="Limite disponível"
				value={money(overview.availableCents, hidden, { sign: "never" })}
				caption={`de ${money(overview.totalLimitCents, hidden, { sign: "never" })} somando ${
					overview.countedCards === 1 ? "o cartão" : `os ${overview.countedCards} cartões`
				}`}
			/>
			<ProgressBar parts={limitBar(rows, overview, colors.surface3)} height={10} />
			{rows.map((r) => {
				const percent = usagePercent(r.usedCents, r.limitCents);
				return (
					<View
						key={r.cardId}
						style={{
							gap: spacing.md,
							padding: 18,
							borderRadius: radius.block,
							backgroundColor: colors.surface,
						}}
					>
						<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
							<BankLogo {...bankBadge(r.card)} size={40} />
							<View style={{ flex: 1, gap: 2 }}>
								<Text variant="bodyStrong" numberOfLines={1}>
									{r.card.name}
								</Text>
								<Text variant="caption" tone="secondary">
									{r.card.last4 ? cardLabel(r.card) : "Cartão de crédito"}
								</Text>
							</View>
							{percent !== null ? (
								<Text variant="bodyStrong" tone="secondary">
									{hidden ? "••" : `${percent}%`}
								</Text>
							) : null}
						</View>
						{percent !== null ? (
							<View
								style={{ height: 6, borderRadius: 3, backgroundColor: colors.surface3, overflow: "hidden" }}
							>
								<View
									style={{
										width: `${Math.min(100, percent)}%`,
										height: 6,
										borderRadius: 3,
										backgroundColor: r.color,
									}}
								/>
							</View>
						) : null}
						<View style={{ flexDirection: "row" }}>
							<Text variant="caption" tone="secondary" style={{ flex: 1 }}>
								Usado {money(r.usedCents, hidden, { sign: "never" })}
							</Text>
							<Text variant="caption" tone="secondary">
								{r.limitCents !== null && r.limitCents > 0
									? `Limite ${money(r.limitCents, hidden, { sign: "never" })}`
									: "Limite não informado"}
							</Text>
						</View>
						<View style={{ height: 1, backgroundColor: colors.border }} />
						<View style={{ flexDirection: "row", gap: spacing.sm }}>
							<Text variant="caption" tone="secondary" style={{ flex: 1 }}>
								{cycleLabel(r.card)}
							</Text>
							<Text variant="caption">Melhor dia de compra: {bestPurchaseDay(r.card, today)}</Text>
						</View>
					</View>
				);
			})}
			<Notice text="Uso estimado: faturas ainda não vencidas mais parcelas futuras. O banco não envia o limite disponível." />
		</View>
	);
}
