import { spacing } from "@orbita/tokens";
import { View } from "react-native";
import type { AccountsView, CardsView, CategoriesView, RecentTransactions } from "../../lib/api.ts";
import { money } from "../../lib/format.ts";
import type { Loadable } from "../../lib/loadable.ts";
import { ListRow, Text } from "../../ui/index.ts";
import { LoadableCard } from "./LoadableCard.tsx";
import { bankColor } from "./summary-model.ts";
import { TransactionDisc } from "./TransactionDisc.tsx";
import {
	amountSignMode,
	initialOf,
	signedAmount,
	transactionCaption,
	transactionIcon,
} from "./transaction-model.ts";

export function RecentCard({
	state,
	accounts,
	cards,
	categories,
	today,
	hidden,
	onSeeAll,
}: {
	state: Loadable<RecentTransactions>;
	/** Só dão nome às linhas; se falharem, as linhas aparecem sem o nome da conta. */
	accounts: AccountsView["accounts"];
	cards: CardsView["cards"];
	categories: CategoriesView["categories"];
	today: string;
	hidden: boolean;
	/** "Ver tudo" abre a tela Atividades. */
	onSeeAll: () => void;
}) {
	const accountById = new Map(accounts.map((a) => [a.id, a]));
	const cardById = new Map(cards.map((c) => [c.id, c]));
	const slugById = new Map(categories.map((c) => [c.id, c.slug]));
	return (
		<LoadableCard
			title="Últimos lançamentos"
			action="Ver tudo"
			onAction={onSeeAll}
			gap={0}
			state={state}
			skeletonLines={4}
		>
			{({ transactions }) =>
				transactions.length === 0 ? (
					<Text variant="body" tone="secondary" style={{ marginTop: spacing.md }}>
						Nenhum lançamento por aqui ainda.
					</Text>
				) : (
					<View style={{ marginTop: spacing.xs, gap: spacing.xs }}>
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
										<TransactionDisc
											icon={transactionIcon(t.kind, t.categoryId ? slugById.get(t.categoryId) : undefined)}
											bank={
												source
													? { initial: initialOf(source.name), color: bankColor(source.bankCode) }
													: undefined
											}
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
