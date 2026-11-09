import { colors, radius, spacing } from "@orbita/tokens";
import { View } from "react-native";
import { useClock } from "../../lib/clock.tsx";
import { money } from "../../lib/format.ts";
import { toLoadable } from "../../lib/loadable.ts";
import { BankLogo, ErrorState, ProgressBar, Skeleton, Text } from "../../ui/index.ts";
import { useInvoicesOverview } from "../summary/queries.ts";
import { bankBadge } from "../summary/summary-model.ts";
import {
	bestPurchaseDay,
	type CardLike,
	cardColor,
	cardLabel,
	cycleLabel,
	limitBar,
	limitsOverview,
	usagePercent,
} from "./card-model.ts";
import { BigNumber, Notice } from "./parts.tsx";

/** Aba Limites: disponível somando os cartões e o uso de cada um. O uso vem do servidor (`GET /v1/invoices/overview`). */
export function LimitsTab({ cards, hidden }: { cards: readonly CardLike[]; hidden: boolean }) {
	const { today } = useClock();
	const invoices = toLoadable(useInvoicesOverview());

	if (invoices.phase === "error") return <ErrorState message={invoices.message} onRetry={invoices.retry} />;
	if (invoices.phase === "loading") {
		return (
			<View accessibilityLabel="Carregando limites" style={{ gap: spacing.lg }}>
				<Skeleton width="60%" height={40} />
				<Skeleton height={10} />
				<Skeleton height={150} />
			</View>
		);
	}

	// O servidor (ledger) calcula o usado: devido das faturas não pagas + aberta + parcelas futuras. Aqui só se exibe.
	const usedByCard = new Map(invoices.data.cards.map((l) => [l.card.id, l.usedLimitCents]));
	const rows = cards.map((card) => ({
		card,
		cardId: card.id,
		limitCents: card.limitCents,
		usedCents: usedByCard.get(card.id) ?? 0,
		color: cardColor(card),
	}));
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
			<Notice text="Uso estimado: o que ainda se deve nas faturas (as já pagas não contam) mais as parcelas futuras." />
		</View>
	);
}
