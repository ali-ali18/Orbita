import { spacing } from "@orbita/tokens";
import { View } from "react-native";
import type { AccountsView, CardsView, CategoriesView, RecentTransactions } from "../../lib/api.ts";
import { money } from "../../lib/format.ts";
import type { Loadable } from "../../lib/loadable.ts";
import { ListRow, Text } from "../../ui/index.ts";
import { LoadableCard } from "./LoadableCard.tsx";
import { bankBadge } from "./summary-model.ts";
import { TransactionDisc } from "./TransactionDisc.tsx";
import {
	amountSignMode,
	amountTone,
	signedAmount,
	transactionBrand,
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
	max,
	onSeeAll,
	onOpen,
}: {
	state: Loadable<RecentTransactions>;
	/** Só dão nome às linhas; se falharem, as linhas aparecem sem o nome da conta. */
	accounts: AccountsView["accounts"];
	cards: CardsView["cards"];
	categories: CategoriesView["categories"];
	today: string;
	hidden: boolean;
	/** 2x4: só as primeiras linhas. */
	max?: number;
	/** "Ver tudo" abre a tela Atividades. */
	onSeeAll: () => void;
	/** Tocar numa linha abre o detalhe do lançamento. */
	onOpen: (id: string) => void;
}) {
	const accountById = new Map(accounts.map((a) => [a.id, a]));
	const cardById = new Map(cards.map((c) => [c.id, c]));
	const categoryById = new Map(categories.map((c) => [c.id, c]));
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
						{(max === undefined ? transactions : transactions.slice(0, max)).map((t) => {
							const source = t.cardId
								? cardById.get(t.cardId)
								: t.accountId
									? accountById.get(t.accountId)
									: undefined;
							return (
								<ListRow
									key={t.id}
									onPress={() => onOpen(t.id)}
									leading={
										<TransactionDisc
											icon={transactionIcon(
												t.kind,
												t.categoryId ? categoryById.get(t.categoryId)?.slug : undefined,
												t.categoryId ? categoryById.get(t.categoryId)?.name : undefined,
											)}
											brand={transactionBrand(t)}
											bank={source ? bankBadge(source) : undefined}
										/>
									}
									title={t.description}
									caption={transactionCaption(t, today, { accounts: accountById, cards: cardById })}
									value={money(signedAmount(t), hidden, { sign: amountSignMode(t.kind) })}
									valueTone={amountTone(t.kind)}
								/>
							);
						})}
					</View>
				)
			}
		</LoadableCard>
	);
}
