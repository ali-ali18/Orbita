import { spacing } from "@orbita/tokens";
import { useMemo, useState } from "react";
import { View } from "react-native";
import { useClock } from "../../lib/clock.tsx";
import { money, monthName } from "../../lib/format.ts";
import { toLoadable } from "../../lib/loadable.ts";
import { ErrorState, Skeleton, Text } from "../../ui/index.ts";
import { useInstallments } from "../summary/queries.ts";
import { type CardLike, installmentTotals, monthColumns, visibleInstallments } from "./card-model.ts";
import { InstallmentCard } from "./InstallmentCard.tsx";
import { InstallmentsChart } from "./InstallmentsChart.tsx";
import { BigNumber, BleedRow, CardChip } from "./parts.tsx";

/** Aba Parcelas: quanto está comprometido no mês, os próximos meses por cartão e cada parcelamento. */
export function InstallmentsTab({ cards, hidden }: { cards: readonly CardLike[]; hidden: boolean }) {
	const { month } = useClock();
	const installments = toLoadable(useInstallments());
	const [filter, setFilter] = useState<string | null>(null);

	const view = useMemo(() => {
		if (installments.phase !== "ready") return null;
		const groups = installments.data.groups;
		return {
			totals: installmentTotals(groups),
			columns: monthColumns(
				groups,
				month,
				cards.map((c) => c.id),
			),
			list: visibleInstallments(groups, filter),
		};
	}, [installments, cards, month, filter]);

	if (installments.phase === "error")
		return <ErrorState message={installments.message} onRetry={installments.retry} />;
	if (!view) {
		return (
			<View accessibilityLabel="Carregando parcelas" style={{ gap: spacing.lg }}>
				<Skeleton width="60%" height={40} />
				<Skeleton height={150} />
				<Skeleton height={140} />
			</View>
		);
	}
	const { totals, columns, list } = view;
	const cardById = new Map(cards.map((c) => [c.id, c]));

	return (
		<View style={{ gap: spacing.lg }}>
			<BigNumber
				label={`Comprometido em ${monthName(month).toLocaleLowerCase("pt-BR")}`}
				value={money(totals.committedCents, hidden, { sign: "never" })}
				caption={
					totals.count === 0
						? "Nada parcelado agora"
						: `Restam ${money(totals.remainingCents, hidden, { sign: "never" })}${totals.estimated ? " (estimado)" : ""} em ${
								totals.count === 1 ? "1 parcelamento" : `${totals.count} parcelamentos`
							}`
				}
			/>
			{columns.some((c) => c.totalCents > 0) ? (
				<>
					<InstallmentsChart columns={columns} cards={cards} hidden={hidden} currentMonth={month} />
					<BleedRow>
						<CardChip card={null} selected={filter === null} onPress={() => setFilter(null)} showName />
						{cards.map((c) => (
							<CardChip
								key={c.id}
								card={c}
								selected={filter === c.id}
								onPress={() => setFilter(c.id)}
								showName
							/>
						))}
					</BleedRow>
					{list.length === 0 ? (
						<Text variant="body" tone="secondary">
							Nenhum parcelamento neste cartão.
						</Text>
					) : (
						list.map((m) => (
							<InstallmentCard
								key={m.groupId}
								model={m}
								card={m.cardId ? cardById.get(m.cardId) : undefined}
								hidden={hidden}
							/>
						))
					)}
				</>
			) : (
				<Text variant="body" tone="secondary">
					Nenhuma compra parcelada agora. Quando você parcelar algo no cartão, ela aparece aqui.
				</Text>
			)}
		</View>
	);
}
