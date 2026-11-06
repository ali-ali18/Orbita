import { colors } from "@orbita/tokens";
import { View } from "react-native";
import type { AccountsView, CardsView, RecentTransactions } from "../../lib/api.ts";
import { money } from "../../lib/format.ts";
import type { Loadable } from "../../lib/loadable.ts";
import { LetterAvatar, ListRow, Text } from "../../ui/index.ts";
import { LoadableCard } from "./LoadableCard.tsx";
import { bankColor } from "./summary-model.ts";
import { amountSignMode, initialOf, signedAmount, transactionCaption } from "./transaction-model.ts";

export function RecentCard({
	state,
	accounts,
	cards,
	today,
	hidden,
}: {
	state: Loadable<RecentTransactions>;
	/** Só dão nome às linhas; se falharem, as linhas aparecem sem o nome da conta. */
	accounts: AccountsView["accounts"];
	cards: CardsView["cards"];
	today: string;
	hidden: boolean;
}) {
	const accountById = new Map(accounts.map((a) => [a.id, a]));
	const cardById = new Map(cards.map((c) => [c.id, c]));
	return (
		<LoadableCard title="Últimos lançamentos" state={state} skeletonLines={4}>
			{({ transactions }) =>
				transactions.length === 0 ? (
					<Text variant="body" tone="secondary">
						Nenhum lançamento por aqui ainda.
					</Text>
				) : (
					<View>
						{transactions.map((t) => {
							const source = t.cardId
								? cardById.get(t.cardId)
								: t.accountId
									? accountById.get(t.accountId)
									: undefined;
							return (
								<ListRow
									key={t.id}
									leading={
										<LetterAvatar
											letter={initialOf(source?.name ?? t.description)}
											size={40}
											color={source ? bankColor(source.bankCode) : colors.surface3}
										/>
									}
									title={t.description}
									caption={transactionCaption(t, today, { accounts: accountById, cards: cardById })}
									value={money(signedAmount(t), hidden, { sign: amountSignMode(t.kind) })}
								/>
							);
						})}
					</View>
				)
			}
		</LoadableCard>
	);
}
