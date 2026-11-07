import { View } from "react-native";
import type { CategoriesView, InvoiceView } from "../../lib/api.ts";
import { money } from "../../lib/format.ts";
import { ListRow, Text } from "../../ui/index.ts";
import { TransactionDisc } from "../summary/TransactionDisc.tsx";
import { transactionIcon } from "../summary/transaction-model.ts";
import {
	emptyInvoiceMessage,
	filterInvoiceLines,
	type InvoiceFilter,
	invoiceLineCaption,
} from "./card-model.ts";

/** Lançamentos da fatura (mais novo primeiro). Estorno aparece com "+", compra sem sinal, como no Figma. */
export function InvoiceLines({
	lines,
	categories,
	filter,
	hidden,
}: {
	lines: InvoiceView["transactions"];
	categories: CategoriesView["categories"];
	filter: InvoiceFilter;
	hidden: boolean;
}) {
	const byId = new Map(categories.map((c) => [c.id, c]));
	const shown = filterInvoiceLines(lines, filter);
	if (shown.length === 0) {
		return (
			<Text variant="body" tone="secondary" style={{ paddingVertical: 16 }}>
				{emptyInvoiceMessage(filter)}
			</Text>
		);
	}
	return (
		<View>
			{shown.map((t) => {
				const category = t.categoryId ? byId.get(t.categoryId) : undefined;
				return (
					<ListRow
						key={t.id}
						leading={<TransactionDisc icon={transactionIcon(t.kind, category?.slug)} />}
						title={t.description}
						caption={invoiceLineCaption(t, category?.name)}
						value={money(t.amountCents, hidden, { sign: t.kind === "refund" ? "always" : "never" })}
						{...(t.status === "pending" ? { badge: "Pendente" } : {})}
					/>
				);
			})}
		</View>
	);
}
