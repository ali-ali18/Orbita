import type { CategoriesView, MonthSummary } from "../../lib/api.ts";
import type { Loadable } from "../../lib/loadable.ts";
import { Text } from "../../ui/index.ts";
import { CategoryDonut } from "./CategoryDonut.tsx";
import { LoadableCard } from "./LoadableCard.tsx";
import { categoryShares } from "./summary-model.ts";

export function CategoriesCard({
	state,
	hidden,
	onPress,
}: {
	state: Loadable<[MonthSummary, CategoriesView]>;
	hidden: boolean;
	onPress?: () => void;
}) {
	return (
		<LoadableCard
			title="Gastos por categoria"
			state={state}
			skeletonLines={4}
			chevron
			{...(onPress ? { onPress } : {})}
		>
			{([summary, { categories }]) => {
				const shares = categoryShares(summary.summary.byCategory, categories);
				if (shares.length === 0) {
					return (
						<Text variant="body" tone="secondary">
							Nenhum gasto neste mês ainda.
						</Text>
					);
				}
				return <CategoryDonut shares={shares} hidden={hidden} />;
			}}
		</LoadableCard>
	);
}
