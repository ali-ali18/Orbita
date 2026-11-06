import { colors, radius, spacing } from "@orbita/tokens";
import { View } from "react-native";
import type { AccountsView, CardsView, CategoriesView, RecentTransactions } from "../../lib/api.ts";
import { money } from "../../lib/format.ts";
import type { Loadable } from "../../lib/loadable.ts";
import { BankLogo, Icon, type IconName, ListRow, Text } from "../../ui/index.ts";
import { LoadableCard } from "./LoadableCard.tsx";
import { bankColor } from "./summary-model.ts";
import {
	amountSignMode,
	initialOf,
	signedAmount,
	transactionCaption,
	transactionIcon,
} from "./transaction-model.ts";

const DISC = 44;
const BADGE = 18;
/** O selo do banco fica em (28, 28) no Figma: canto de baixo à direita do disco, vazando 2. */
const BADGE_OFFSET = 28;

/** Disco de 44 com o ícone da categoria e, se houver conta ou cartão, o selo do banco por cima. */
function TransactionDisc({
	icon,
	bank,
}: {
	icon: IconName;
	bank?: { initial: string; color: string } | undefined;
}) {
	return (
		<View style={{ width: DISC, height: DISC }}>
			<View
				style={{
					width: DISC,
					height: DISC,
					borderRadius: radius.pill,
					backgroundColor: colors.surface2,
					alignItems: "center",
					justifyContent: "center",
				}}
			>
				<Icon name={icon} size={20} />
			</View>
			{bank ? (
				<View style={{ position: "absolute", left: BADGE_OFFSET, top: BADGE_OFFSET }}>
					<BankLogo initial={bank.initial} color={bank.color} size={BADGE} ring={colors.background} />
				</View>
			) : null}
		</View>
	);
}

export function RecentCard({
	state,
	accounts,
	cards,
	categories,
	today,
	hidden,
}: {
	state: Loadable<RecentTransactions>;
	/** Só dão nome às linhas; se falharem, as linhas aparecem sem o nome da conta. */
	accounts: AccountsView["accounts"];
	cards: CardsView["cards"];
	categories: CategoriesView["categories"];
	today: string;
	hidden: boolean;
}) {
	const accountById = new Map(accounts.map((a) => [a.id, a]));
	const cardById = new Map(cards.map((c) => [c.id, c]));
	const slugById = new Map(categories.map((c) => [c.id, c.slug]));
	return (
		<LoadableCard title="Últimos lançamentos" action="Ver tudo" gap={0} state={state} skeletonLines={4}>
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
