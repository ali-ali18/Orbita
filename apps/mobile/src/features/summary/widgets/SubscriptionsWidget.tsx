import { spacing } from "@orbita/tokens";
import { View } from "react-native";
import { brandOf } from "../../../lib/brands.ts";
import { money } from "../../../lib/format.ts";
import { toLoadable } from "../../../lib/loadable.ts";
import { StoreDisc, Text } from "../../../ui/index.ts";
import { useRecurrences } from "../../subscriptions/queries.ts";
import {
	countLabel,
	nextCharge,
	nextSummary,
	sortSubscriptions,
} from "../../subscriptions/subscriptions-model.ts";
import { Figure, Tile } from "../BankCards.tsx";
import { LoadableCard } from "../LoadableCard.tsx";

const MAX_ROWS = 5;

/**
 * Assinaturas: o compromisso mensal e a contagem vêm do servidor (`subscriptions` da lista de recorrências); o app só
 * ordena as cobranças pela próxima data. 2x2: o valor; 2x4: com a próxima cobrança; 4x4: a lista.
 */
export function SubscriptionsWidget({
	size,
	today,
	hidden,
	onPress,
}: {
	size: "2x2" | "2x4" | "4x4";
	today: string;
	hidden: boolean;
	onPress: () => void;
}) {
	const state = toLoadable(useRecurrences());
	const total = (cents: number) => money(cents, hidden, { sign: "never" });

	if (size === "2x2") {
		return (
			<Tile title="Assinaturas" label="Assinaturas, abrir" state={state} onPress={onPress}>
				{({ subscriptions }) => (
					<Figure
						value={subscriptions.count === 0 ? "—" : total(subscriptions.monthlyCents)}
						caption={subscriptions.count === 0 ? "Nenhuma ainda" : countLabel(subscriptions.count)}
					/>
				)}
			</Tile>
		);
	}

	return (
		<LoadableCard
			title="Assinaturas"
			state={state}
			skeletonLines={size === "2x4" ? 2 : 5}
			chevron
			onPress={onPress}
			gap={spacing.sm}
		>
			{({ recurrences, subscriptions }) => {
				if (subscriptions.count === 0) {
					return (
						<Text variant="body" tone="secondary">
							Nenhuma assinatura ainda.
						</Text>
					);
				}
				const head = (
					<View style={{ gap: 2 }}>
						<Text variant="numberLarge" adjustsFontSizeToFit numberOfLines={1}>
							{total(subscriptions.monthlyCents)}
						</Text>
						<Text variant="caption" tone="secondary" numberOfLines={1}>
							{size === "2x4"
								? (nextSummary(recurrences, today) ?? `${countLabel(subscriptions.count)} por mês`)
								: `${countLabel(subscriptions.count)} por mês`}
						</Text>
					</View>
				);
				if (size === "2x4") return head;
				const list = sortSubscriptions(recurrences, today).slice(0, MAX_ROWS);
				const more = subscriptions.count - list.length;
				return (
					<View style={{ gap: spacing.lg }}>
						{head}
						<View style={{ gap: spacing.md }}>
							{list.map((r) => {
								const next = nextCharge(r, today);
								return (
									<View key={r.id} style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
										<StoreDisc brand={brandOf(r.name)} icon="assinatura" size={32} />
										<View style={{ flex: 1 }}>
											<Text variant="body" numberOfLines={1}>
												{r.name}
											</Text>
											<Text variant="caption" tone="secondary" numberOfLines={1}>
												{next ? `Próxima: dia ${Number(next.slice(8, 10))}` : "Encerrada"}
											</Text>
										</View>
										<Text variant="bodyStrong" numberOfLines={1}>
											{total(r.amountCents)}
										</Text>
									</View>
								);
							})}
							{more > 0 ? (
								<Text variant="caption" tone="secondary">
									+{more} {more === 1 ? "assinatura" : "assinaturas"}
								</Text>
							) : null}
						</View>
					</View>
				);
			}}
		</LoadableCard>
	);
}
