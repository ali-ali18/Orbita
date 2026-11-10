import { colors, radius, spacing } from "@orbita/tokens";
import { View } from "react-native";
import { useClock } from "../../lib/clock.tsx";
import { money } from "../../lib/format.ts";
import { toLoadable } from "../../lib/loadable.ts";
import { BankLogo, CardHighlight, ErrorState, Ring, Skeleton, Text } from "../../ui/index.ts";
import { useNow } from "../banks/use-now.ts";
import { freshnessLabel } from "../summary/bank-cards-model.ts";
import { useInvoicesOverview } from "../summary/queries.ts";
import { bankBadge } from "../summary/summary-model.ts";
import {
	bestPurchaseDay,
	type CardLike,
	cardColor,
	cardLabel,
	cycleLabel,
	usagePercent,
} from "./card-model.ts";
import { Notice } from "./parts.tsx";

/**
 * Aba Limites: anel com o uso total e uma linha por banco (usado, disponível, barra). Tudo vem do servidor
 * (`GET /v1/invoices/overview`): com o disponível do banco, usado = limite − disponível; sem ele, é estimativa do
 * Órbita e a tela diz "estimado".
 */
export function LimitsTab({ cards, hidden }: { cards: readonly CardLike[]; hidden: boolean }) {
	const { today } = useClock();
	const now = useNow();
	const overview = toLoadable(useInvoicesOverview());

	if (overview.phase === "error") return <ErrorState message={overview.message} onRetry={overview.retry} />;
	if (overview.phase === "loading") {
		return (
			<View accessibilityLabel="Carregando limites" style={{ gap: spacing.lg }}>
				<Skeleton width="60%" height={96} />
				<Skeleton height={150} />
			</View>
		);
	}

	const { limits, cards: lines } = overview.data;
	const fmt = (cents: number) => money(cents, hidden, { sign: "never" });
	const cardById = new Map(cards.map((c) => [c.id, c]));
	const percent = usagePercent(limits.usedCents, limits.limitCents) ?? 0;
	const anyEstimated = lines.some((l) => l.limit.source === "estimated");
	const fresh = freshnessLabel(limits.oldestSyncedAt, now);

	if (limits.cardsCounted === 0) {
		return (
			<View style={{ gap: spacing.lg }}>
				<Text variant="cardTitle" tone="secondary">
					Limite disponível
				</Text>
				<Text variant="numberHero">—</Text>
				<Notice text="O banco não informou o limite dos seus cartões. Quando a sincronização trouxer, o uso de cada um aparece aqui." />
			</View>
		);
	}

	return (
		<View style={{ gap: spacing.lg }}>
			<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xl }}>
				<Ring percent={percent} size={112} stroke={12} label={`${percent}% do limite usado`}>
					<Text variant="numberMedium">{`${percent}%`}</Text>
					<Text variant="micro" tone="secondary">
						usado
					</Text>
				</Ring>
				<View style={{ flex: 1, gap: spacing.xs }}>
					<Text variant="cardTitle" tone="secondary">
						Limite disponível
					</Text>
					<Text variant="numberLarge" adjustsFontSizeToFit numberOfLines={1}>
						{fmt(limits.availableCents)}
					</Text>
					<Text variant="caption" tone="secondary">
						de {fmt(limits.limitCents)}
					</Text>
					{fresh && !anyEstimated ? (
						<Text variant="micro" tone="tertiary">
							{fresh}
						</Text>
					) : null}
				</View>
			</View>

			{lines.map((line) => {
				const { limit } = line;
				const card = cardById.get(line.card.id);
				const share = usagePercent(limit.usedCents, limit.limitCents);
				const color = card ? cardColor(card) : colors.text;
				return (
					<View
						key={line.card.id}
						style={{
							gap: spacing.md,
							padding: 18,
							borderRadius: radius.block,
							backgroundColor: colors.surface,
						}}
					>
						<CardHighlight radius={radius.block} />
						<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
							<BankLogo {...bankBadge(line.card)} size={40} />
							<View style={{ flex: 1, gap: 2 }}>
								<Text variant="bodyStrong" numberOfLines={1}>
									{line.card.name}
								</Text>
								<Text variant="caption" tone="secondary">
									{line.card.last4 ? cardLabel(line.card) : "Cartão de crédito"}
								</Text>
							</View>
							{share !== null ? (
								<Text variant="bodyStrong" tone="secondary">
									{`${share}%`}
								</Text>
							) : null}
						</View>
						{share !== null ? (
							<View
								accessibilityRole="progressbar"
								accessibilityLabel={`${share}% do limite usado`}
								style={{ height: 6, borderRadius: 3, backgroundColor: colors.surface3, overflow: "hidden" }}
							>
								<View
									style={{
										width: `${Math.min(100, share)}%`,
										height: 6,
										borderRadius: 3,
										backgroundColor: color,
									}}
								/>
							</View>
						) : null}
						<Text variant="caption" tone="secondary">
							Usado {fmt(limit.usedCents)}
							{limit.availableCents === null ? "" : ` · disponível ${fmt(limit.availableCents)}`}
						</Text>
						{limit.approvedLimitCents != null &&
						limit.limitCents !== null &&
						limit.approvedLimitCents > limit.limitCents ? (
							<Text variant="micro" tone="tertiary">
								{`Limite ${fmt(limit.limitCents)} · aprovado ${fmt(limit.approvedLimitCents)}`}
							</Text>
						) : null}
						{card ? (
							<View style={{ flexDirection: "row", gap: spacing.sm }}>
								<Text variant="caption" tone="secondary" style={{ flex: 1 }}>
									{cycleLabel(card)}
								</Text>
								<Text variant="caption">Melhor dia de compra: {bestPurchaseDay(card, today)}</Text>
							</View>
						) : null}
					</View>
				);
			})}
			{anyEstimated ? (
				<Notice text="Estimado: o banco não informou o limite disponível. O uso soma o que ainda se deve nas faturas (as pagas não contam) e as parcelas futuras." />
			) : null}
		</View>
	);
}
